#!/usr/bin/env node

/**
 * Test script for Progress Snapshots Service
 */

import fetch from 'node-fetch';

const API_URL = 'http://localhost:3001/api';

async function testSnapshots() {
  console.log('🧪 Testing Progress Snapshots Service...\n');

  try {
    // 1. Create a manual snapshot
    console.log('📸 Creating manual snapshot...');
    const snapshotResponse = await fetch(`${API_URL}/analytics/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const snapshotResult = await snapshotResponse.json();
    console.log('Snapshot result:', snapshotResult);
    
    if (!snapshotResult.success) {
      console.error('❌ Failed to create snapshot:', snapshotResult.error);
      return;
    }
    
    // 2. Get progress comparison
    console.log('\n📊 Testing progress comparison...');
    
    // Get some node IDs from the snapshot result
    const nodeIds = snapshotResult.snapshots
      .slice(0, 3)
      .map(s => s.nodeId)
      .filter(id => id);
    
    if (nodeIds.length > 0) {
      console.log(`Comparing progress for nodes: ${nodeIds.join(', ')}`);
      
      for (const period of ['30d', '7d', 'today']) {
        const compareResponse = await fetch(
          `${API_URL}/analytics/progress-comparison?period=${period}&nodeIds=${nodeIds.join(',')}`
        );
        
        const compareResult = await compareResponse.json();
        console.log(`\n${period} comparison:`, JSON.stringify(compareResult, null, 2));
      }
    } else {
      console.log('No nodes found in snapshot result');
    }
    
    // 3. Get available snapshots for a specific node
    if (nodeIds.length > 0) {
      console.log(`\n📅 Getting available snapshots for node ${nodeIds[0]}...`);
      const snapshotsResponse = await fetch(`${API_URL}/analytics/snapshots/${nodeIds[0]}`);
      const snapshotsResult = await snapshotsResponse.json();
      console.log('Available snapshots:', snapshotsResult);
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run tests
testSnapshots();