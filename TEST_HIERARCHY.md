# Инструкция по тестированию иерархии WebSocket

## Подготовка

1. Очистите Redis для чистого теста:
```bash
docker exec -it optimistic-redis redis-cli FLUSHALL
```

2. Откройте консоль разработчика в браузере (F12)

3. Откройте приложение Graphy: http://localhost:5173

## Тест 1: Создание иерархии через WebSocket

1. **Создайте корневую ноду**
   - Нажмите "d" или используйте UI для создания DAO ноды
   - Назовите её "Parent Node"
   - В консоли должно появиться:
   ```
   🚀 Sending operation: ADD_NODE
   ```

2. **Навигируйтесь в родительскую ноду**
   - Дважды кликните на "Parent Node"
   - Вы должны увидеть пустое пространство внутри ноды

3. **Создайте дочернюю ноду**
   - Нажмите "d" снова
   - Назовите её "Child Node"
   - В консоли должно появиться:
   ```
   Intercepting node add with parentId: <parent_id>
   ```

4. **Проверьте структуру в консоли сервера**
   - В логах Docker должно быть:
   ```
   📊 Graph structure check before sending:
     Root nodes: 1
     Node "Parent Node" has 1 children
     Total nodes in hierarchy: 2
   ```

5. **Обновите страницу (F5)**

6. **Проверьте результат**
   - ❌ **Проблема**: Обе ноды появляются на верхнем уровне
   - ✅ **Ожидаемо**: "Parent Node" на верхнем уровне, "Child Node" внутри неё

## Тест 2: Сохранение через кнопку Save

1. Повторите шаги 1-3 из Теста 1

2. **Нажмите кнопку "Save"** в UI

3. **Обновите страницу**

4. **Проверьте результат**
   - ✅ Иерархия должна сохраниться корректно

## Что проверить в консоли браузера

При загрузке после обновления страницы:
```javascript
// В консоли браузера должно быть:
📊 TreeDaoStore: Loading initial graph state
  → Loading 1 nodes and 0 edges  // <-- Проблема если здесь 2 nodes!
  ✅ Graph state loaded successfully
```

## Что проверить в логах Docker

```bash
# Просмотр логов backend
docker logs -f optimistic-backend --tail 50
```

Ищите:
1. При сохранении:
   ```
   💾 Saving graph main: 1 nodes, 0 edges
   ```

2. При загрузке:
   ```
   📊 Graph structure check before sending:
     Root nodes: 1
     Node "Parent Node" has 1 children
     Total nodes in hierarchy: 2
   ```

## Проверка данных в Redis

```bash
# Подключиться к Redis
docker exec -it optimistic-redis redis-cli

# Получить граф
GET graph:main

# Выйти
exit
```

Данные должны выглядеть так:
```json
{
  "nodes": [
    {
      "id": "xxx",
      "title": "Parent Node",
      "children": [
        {
          "id": "yyy",
          "title": "Child Node",
          "children": []
        }
      ]
    }
  ],
  "edges": []
}
```

## Анализ проблемы

### Если иерархия НЕ сохраняется:

1. **Проверьте что parentId передается**
   - В консоли браузера при создании дочерней ноды
   - В payload операции ADD_NODE

2. **Проверьте обработку на сервере**
   - Логи должны показывать правильную иерархию
   - Redis должен содержать вложенную структуру

3. **Проверьте загрузку на клиенте**
   - handleGraphState должен получать иерархическую структуру
   - setRootNodes должен правильно её обрабатывать

## Временное решение

Если проблема подтверждается, используйте кнопку "Save" после создания структуры - она корректно сохраняет иерархию через REST API.

## Постоянное решение

Проблема в обработке `GRAPH_STATE` на клиенте. Нужно убедиться, что:

1. Сервер отправляет иерархическую структуру (уже делает)
2. Клиент правильно её интерпретирует в `handleGraphState`
3. `setRootNodes` не "сплющивает" структуру

Решение находится в файле `HIERARCHY_FIX.md`