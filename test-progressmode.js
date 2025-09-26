#!/usr/bin/env node

/**
 * Тест для проверки фильтрации progressMode
 */

const fetch = require('node-fetch');

async function testProgressMode() {
  console.log('🧪 Testing progressMode filtering...\n');
  
  // 1. Сначала сохраним граф с недопустимым progressMode
  console.log('1️⃣ Saving graph with invalid progressMode="manual"...');
  const saveResponse = await fetch('http://localhost:3001/api/graphs/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nodes: [
        {
          id: 'node_test_1',
          title: 'Test Node',
          nodeType: 'dao',
          nodeSubtype: 'simple',
          progressMode: 'manual', // недопустимое значение
          position: { x: 100, y: 100 }
        },
        {
          id: 'node_test_2', 
          title: 'Fundamental Node',
          nodeType: 'fundamental',
          progressMode: 'upstream', // допустимое значение
          position: { x: 200, y: 200 }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
  });
  
  const saveResult = await saveResponse.json();
  console.log('Save result:', saveResult);
  
  // 2. Теперь загрузим граф обратно
  console.log('\n2️⃣ Loading graph back...');
  const loadResponse = await fetch('http://localhost:3001/api/graphs/test');
  const loadedGraph = await loadResponse.json();
  
  console.log('\n📊 Loaded nodes:');
  loadedGraph.nodes.forEach(node => {
    console.log(`  - ${node.id}: progressMode = "${node.progressMode}" (was "${node.id === 'node_test_1' ? 'manual' : 'upstream'}")`);
  });
  
  // 3. Проверка результата
  console.log('\n✅ Test Results:');
  const node1 = loadedGraph.nodes.find(n => n.id === 'node_test_1');
  const node2 = loadedGraph.nodes.find(n => n.id === 'node_test_2');
  
  if (node1) {
    if (node1.progressMode === 'children') {
      console.log('✅ Node 1: progressMode correctly converted from "manual" to "children"');
    } else {
      console.log('❌ Node 1: progressMode NOT converted, still:', node1.progressMode);
    }
  }
  
  if (node2) {
    if (node2.progressMode === 'upstream') {
      console.log('✅ Node 2: progressMode correctly preserved as "upstream"');
    } else {
      console.log('❌ Node 2: progressMode incorrectly changed to:', node2.progressMode);
    }
  }
  
  // 4. Cleanup
  console.log('\n🧹 Cleaning up test data...');
  const cleanupResponse = await fetch('http://localhost:3001/api/graphs/test', {
    method: 'DELETE'
  });
  console.log('Cleanup response status:', cleanupResponse.status);
}

testProgressMode().catch(console.error);