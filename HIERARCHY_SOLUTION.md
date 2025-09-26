# Решение проблемы с иерархией parent-child при WebSocket операциях

## Описание проблемы
При создании дочерних нод через WebSocket (real-time операции), они появлялись на корневом уровне после перезагрузки страницы, вместо того чтобы оставаться внутри родительских нод.

## Причина проблемы
1. При добавлении дочерней ноды, фронтенд отправлял только операцию `ADD_NODE` с `parentId`
2. Сервер добавлял новую ноду в Redis, но не обновлял родительскую ноду
3. При загрузке графа из Redis, структура была неполной

## Решение

### 1. Фронтенд (graphy/stores/models/TreeDaoStore.js)
При добавлении дочерней ноды теперь отправляются ДВЕ операции:

```javascript
// Send to optimistic backend via WebSocket
if (!IS_TEST && optimisticIntegration.isConnected) {
  const parentId = currentNode ? currentNode.id : null;
  
  // 1. Отправляем ADD_NODE для новой ноды
  optimisticIntegration.interceptNodeAdd(newNode, parentId);
  
  // 2. Отправляем UPDATE_NODE для родителя с обновленным списком children
  if (currentNode) {
    const parentSnapshot = getSnapshot(currentNode);
    optimisticIntegration.interceptNodeUpdate(currentNode.id, {
      children: parentSnapshot.children,
      nodeSubtype: currentNode.nodeSubtype
    });
  }
}
```

### 2. Сервер (dao_api2/src/simple-server.js)

#### Обработка ADD_NODE:
- Находит родительскую ноду по `parentId`
- Добавляет новую ноду в `children` родителя
- Обновляет `nodeSubtype` родителя при необходимости
- Логирует структуру для отладки

```javascript
case 'ADD_NODE':
  // ... создание новой ноды ...
  
  if (payload.parentId) {
    const findAndAddToParent = (nodes, depth = 0) => {
      for (let node of nodes) {
        if (node.id === payload.parentId) {
          if (!node.children) node.children = [];
          node.children.push(newNode);
          
          // Обновляем subtype родителя
          if (node.nodeType === 'dao' && node.nodeSubtype === 'simple') {
            node.nodeSubtype = 'withChildren';
          }
          return true;
        }
        // Рекурсивно ищем в детях
        if (node.children && node.children.length > 0) {
          if (findAndAddToParent(node.children, depth + 1)) return true;
        }
      }
      return false;
    };
    
    findAndAddToParent(graph.nodes);
  }
  break;
```

#### Обработка UPDATE_NODE:
- Поддерживает обновление массива `children`
- Обновляет `nodeSubtype` и другие поля
- Рекурсивно находит ноду в иерархии

```javascript
case 'UPDATE_NODE':
  const updateNodeRecursive = (nodes) => {
    for (let node of nodes) {
      if (node.id === payload.id) {
        // Специальная обработка для children
        if (payload.updates.children !== undefined) {
          node.children = payload.updates.children;
        }
        // Обновляем остальные поля
        Object.assign(node, payload.updates);
        return true;
      }
      // Рекурсивно ищем в детях
      if (node.children && node.children.length > 0) {
        if (updateNodeRecursive(node.children)) return true;
      }
    }
    return false;
  };
  updateNodeRecursive(graph.nodes);
  break;
```

## Поток операций

### При создании дочерней ноды:
1. **Локально**: 
   - `currentNode.adoptNode(newNode)` - добавляет дочернюю ноду
   - `currentNode.setNodeSubtype('withChildren')` - обновляет тип родителя

2. **WebSocket отправляет**:
   - `ADD_NODE` с `parentId` - создание новой ноды
   - `UPDATE_NODE` для родителя - обновление списка children

3. **Сервер**:
   - Обрабатывает `ADD_NODE` - создает ноду (но это дублирование)
   - Обрабатывает `UPDATE_NODE` - обновляет родителя с правильной структурой
   - Сохраняет в Redis полную иерархию
   - Транслирует операции всем клиентам

4. **Другие клиенты**:
   - Применяют `ADD_NODE` операцию
   - Применяют `UPDATE_NODE` операцию
   - Получают синхронизированную иерархию

## Преимущества решения

1. **Полная синхронизация**: Родительская нода всегда имеет актуальный список детей
2. **Совместимость**: Работает как с WebSocket, так и с REST API (кнопка Save)
3. **Надежность**: Даже если одна операция потеряется, структура восстановится
4. **Простота**: Логика разделена между фронтендом и бэкендом

## Тестирование

1. Создать родительскую ноду
2. Навигироваться внутрь
3. Создать дочернюю ноду
4. Обновить страницу
5. ✅ Дочерняя нода должна остаться внутри родителя

## Отладка

В консоли браузера при создании дочерней ноды:
```
🚀 Intercepting node add: "New Node" with parentId: abc-123
📦 ADD_NODE payload: {...}
🔄 Also sending UPDATE for parent node abc-123 with 1 children
```

В логах сервера:
```
Looking for parent abc-123 to add child xyz-789
✅ Found parent and added child at depth 0
📝 Updated parent subtype to 'withChildren'
📊 After ADD_NODE - Graph has 2 root nodes
📊 Total nodes in hierarchy: 3
```

## Альтернативные решения (не используются)

1. **Только сервер**: Сервер мог бы автоматически обновлять родителя, но это создало бы дополнительную логику
2. **Полная перезагрузка**: Можно было бы перезагружать весь граф, но это неэффективно
3. **Отдельная операция**: Можно создать специальную операцию ADD_CHILD, но это усложнит протокол

## Заключение

Решение обеспечивает корректное сохранение иерархии parent-child при использовании WebSocket операций, сохраняя при этом простоту и эффективность системы Optimistic UI.