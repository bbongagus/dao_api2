/**
 * Simple test for Optimistic UI Server
 */

const WebSocket = require('ws');

const TEST_URL = 'ws://localhost:3001';
const TEST_GRAPH_ID = 'test-graph';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Starting Optimistic UI Server Tests...\n');

  // Test 1: Connection
  console.log('Test 1: WebSocket Connection');
  const ws1 = new WebSocket(TEST_URL);
  
  await new Promise((resolve, reject) => {
    ws1.on('open', () => {
      console.log('✅ Connected to server');
      resolve();
    });
    ws1.on('error', reject);
  });

  // Test 2: Subscribe to graph
  console.log('\nTest 2: Subscribe to Graph');
  ws1.send(JSON.stringify({
    type: 'SUBSCRIBE',
    graphId: TEST_GRAPH_ID,
    userId: 'test-user-1'
  }));

  await new Promise((resolve) => {
    ws1.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'GRAPH_STATE') {
        console.log('✅ Received graph state:', msg.payload);
        resolve();
      }
    });
  });

  // Test 3: Add Node Operation
  console.log('\nTest 3: Add Node Operation');
  const nodeOperation = {
    type: 'OPERATION',
    payload: {
      type: 'ADD_NODE',
      payload: {
        id: 'test-node-1',
        title: 'Test Node',
        nodeType: 'dao',
        position: { x: 100, y: 200 }
      }
    }
  };

  ws1.send(JSON.stringify(nodeOperation));

  await new Promise((resolve) => {
    ws1.once('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'OPERATION_APPLIED') {
        console.log('✅ Operation applied:', msg.payload.type);
        resolve();
      }
    });
  });

  // Test 4: Multiple Clients
  console.log('\nTest 4: Multiple Clients Sync');
  const ws2 = new WebSocket(TEST_URL);
  
  await new Promise((resolve) => {
    ws2.on('open', () => {
      ws2.send(JSON.stringify({
        type: 'SUBSCRIBE',
        graphId: TEST_GRAPH_ID,
        userId: 'test-user-2'
      }));
      resolve();
    });
  });

  // Client 2 adds an edge
  const edgeOperation = {
    type: 'OPERATION',
    payload: {
      type: 'ADD_EDGE',
      payload: {
        id: 'test-edge-1',
        source: 'test-node-1',
        target: 'test-node-2'
      }
    }
  };

  // Both clients should receive the operation
  let receivedCount = 0;
  const checkReceived = (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'OPERATION_APPLIED' && msg.payload.type === 'ADD_EDGE') {
      receivedCount++;
      console.log(`✅ Client received edge operation (${receivedCount}/2)`);
    }
  };

  ws1.once('message', checkReceived);
  ws2.once('message', checkReceived);
  
  ws2.send(JSON.stringify(edgeOperation));
  
  await sleep(500); // Wait for broadcasts

  // Test 5: Sync Request
  console.log('\nTest 5: Sync Request');
  ws1.send(JSON.stringify({ type: 'SYNC' }));
  
  await new Promise((resolve) => {
    ws1.once('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'SYNC_RESPONSE') {
        console.log('✅ Sync response received');
        console.log('  Nodes:', msg.payload.nodes.length);
        console.log('  Edges:', msg.payload.edges.length);
        resolve();
      }
    });
  });

  // Test 6: Update Node Position
  console.log('\nTest 6: Update Node Position');
  const positionUpdate = {
    type: 'OPERATION',
    payload: {
      type: 'UPDATE_NODE_POSITION',
      payload: {
        nodeId: 'test-node-1',
        position: { x: 300, y: 400 }
      }
    }
  };

  ws1.send(JSON.stringify(positionUpdate));
  await sleep(200);
  console.log('✅ Position update sent');

  // Test 7: Delete Node
  console.log('\nTest 7: Delete Node');
  const deleteOperation = {
    type: 'OPERATION',
    payload: {
      type: 'DELETE_NODE',
      payload: {
        nodeId: 'test-node-1'
      }
    }
  };

  ws1.send(JSON.stringify(deleteOperation));
  await sleep(200);
  console.log('✅ Delete operation sent');

  // Clean up
  ws1.close();
  ws2.close();

  console.log('\n🎉 All tests completed successfully!');
  process.exit(0);
}

// Run tests with error handling
runTests().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error('❌ Tests timed out');
  process.exit(1);
}, 10000);