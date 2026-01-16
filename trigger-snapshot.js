/**
 * Manual trigger for daily progress snapshot
 * Run with: node trigger-snapshot.js
 */

import progressSnapshots from './src/progress-snapshots.js';

async function runSnapshot() {
  console.log('📸 Triggering daily snapshot manually...');
  console.log('   Date:', new Date().toISOString());
  console.log('   User: 1');
  console.log('   Graph: main');
  console.log('');
  
  try {
    const snapshots = await progressSnapshots.snapshotAllNodes(new Date(), '1', 'main');
    console.log('');
    console.log('✅ Snapshot completed successfully!');
    console.log('   Total nodes snapshot:', snapshots.length);
    
    if (snapshots.length > 0) {
      console.log('');
      console.log('Sample snapshots:');
      snapshots.slice(0, 5).forEach((snap, i) => {
        console.log(`   ${i + 1}. Node: ${snap.nodeId} - ${snap.title}`);
        console.log(`      Progress: ${snap.progress}%`);
        console.log(`      Completions: ${snap.currentCompletions}/${snap.requiredCompletions}`);
      });
    }
  } catch (error) {
    console.error('❌ Snapshot failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
  
  process.exit(0);
}

runSnapshot();
