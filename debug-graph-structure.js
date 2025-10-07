import redis from './src/redis.js';

async function debugGraphStructure() {
  try {
    const graphKey = 'user:test-user-001:graph:main';
    const graphData = await redis.get(graphKey);
    
    if (!graphData) {
      console.log('❌ Graph not found at', graphKey);
      return;
    }
    
    const graph = JSON.parse(graphData);
    console.log('📊 Graph structure:');
    console.log('Total top-level nodes:', graph.nodes?.length || 0);
    console.log('\n');
    
    // Recursive function to print tree
    function printNode(node, level = 0) {
      const indent = '  '.repeat(level);
      console.log(`${indent}📌 ${node.title || node.id}`);
      console.log(`${indent}   ID: ${node.id}`);
      console.log(`${indent}   Type: ${node.type || 'unknown'}`);
      console.log(`${indent}   Children type: ${Array.isArray(node.children) ? 'array' : typeof node.children}`);
      console.log(`${indent}   Children count: ${node.children?.length || 0}`);
      
      if (node.children && node.children.length > 0) {
        console.log(`${indent}   Children IDs: ${JSON.stringify(node.children.slice(0, 3))}${node.children.length > 3 ? '...' : ''}`);
      }
      console.log('');
      
      // If children are objects (nested), recurse
      if (node.children && Array.isArray(node.children) && node.children.length > 0) {
        if (typeof node.children[0] === 'object') {
          console.log(`${indent}   ⚠️ Children are OBJECTS (nested structure)`);
          node.children.forEach(child => printNode(child, level + 1));
        } else {
          console.log(`${indent}   ℹ️ Children are IDs (flat structure with references)`);
        }
      }
    }
    
    console.log('=== TOP LEVEL NODES ===\n');
    graph.nodes.forEach((node, index) => {
      console.log(`\n--- Node ${index + 1} ---`);
      printNode(node, 0);
    });
    
    // Count all nodes recursively
    function countAllNodes(nodes) {
      let count = 0;
      for (const node of nodes) {
        count++;
        if (node.children && Array.isArray(node.children) && typeof node.children[0] === 'object') {
          count += countAllNodes(node.children);
        }
      }
      return count;
    }
    
    const totalNodes = countAllNodes(graph.nodes);
    console.log('\n📈 Total nodes in tree (if nested):', totalNodes);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await redis.quit();
  }
}

debugGraphStructure();