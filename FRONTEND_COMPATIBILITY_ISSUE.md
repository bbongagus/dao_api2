# Проблема совместимости Frontend и Backend

## Описание проблемы

При загрузке графа из нового Optimistic Backend возникает ошибка:
```
Error while converting to TreeNode:
path "/progressMode" value "manual" is not assignable to type: ProgressMode
```

## Причина

Frontend модель `TreeNode` в файле `graphy/stores/models/TreeDaoStore.js` определяет `progressMode` как enumeration с ограниченными значениями:
```javascript
progressMode: types.optional(types.enumeration("ProgressMode", ["children", "upstream", "downstream"]), "children")
```

Но backend или сохраненные данные содержат значение `"manual"`, которое не входит в список разрешенных значений.

## Решение

### Вариант 1: Исправить на уровне Backend (РЕКОМЕНДУЕТСЯ)
Преобразовать недопустимые значения progressMode при загрузке/сохранении:

```javascript
// В файле dao_api2/src/simple-server.js
// При загрузке графа
app.get('/api/graphs/:graphId', async (req, res) => {
  try {
    const data = await redis.get(`graph:${req.params.graphId}`);
    const graph = data ? JSON.parse(data) : {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      version: 0
    };
    
    // Фикс для совместимости с frontend
    if (graph.nodes) {
      graph.nodes = graph.nodes.map(node => {
        // Преобразуем недопустимые значения progressMode
        if (node.progressMode && !['children', 'upstream', 'downstream'].includes(node.progressMode)) {
          node.progressMode = 'children'; // значение по умолчанию
        }
        return node;
      });
    }
    
    res.json(graph);
  } catch (error) {
    console.error('Error loading graph:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### Вариант 2: Исправить на уровне Frontend
Добавить "manual" в список разрешенных значений в `TreeDaoStore.js`:
```javascript
progressMode: types.optional(types.enumeration("ProgressMode", ["children", "upstream", "downstream", "manual"]), "children")
```

### Вариант 3: Очистить существующие данные
Удалить некорректные данные из Redis:
```bash
docker-compose -f docker-compose.clean.yml exec redis redis-cli
> DEL graph:main
> exit
```

## Быстрое исправление

Для быстрого исправления применим Вариант 1 - добавим преобразование на backend.

## Долгосрочное решение

1. Создать единую схему данных, используемую и frontend, и backend
2. Добавить валидацию данных при сохранении
3. Создать миграции для обновления существующих данных
4. Использовать TypeScript для типобезопасности

## Статус

⚠️ Требуется исправление для полной совместимости frontend и backend