/**
 * Manual trigger for daily completions reset
 * Simulates a new day by clearing today's completions
 * Run with: node trigger-daily-reset.js
 */

import redis from './src/redis.js';
import dailyCompletions from './src/services/dailyCompletions.js';

async function triggerDailyReset() {
  console.log('🔄 Triggering daily completions reset manually...');
  console.log('   User: 1');
  console.log('   Graph: main');
  console.log('');
  
  try {
    // Get today's completions before clearing
    const todayCompletions = await dailyCompletions.getCompletionIds('1', 'main');
    
    if (todayCompletions.length > 0) {
      console.log(`📅 Found ${todayCompletions.length} completions for today:`);
      todayCompletions.forEach((id, i) => {
        console.log(`   ${i + 1}. ${id}`);
      });
      console.log('');
    } else {
      console.log('📭 No completions found for today');
      console.log('');
    }
    
    // Clear today's completions
    await dailyCompletions.clearCompletions('1', 'main');
    
    console.log('✅ Daily completions cleared successfully');
    console.log('');
    console.log('What this does:');
    console.log('   - Clears the list of nodes completed today');
    console.log('   - Repeatable nodes (infinity mode) will show 0 completions');
    console.log('   - Eye-toggle feature will hide/show nodes based on new day');
    console.log('');
    console.log('Next steps:');
    console.log('   1. Refresh frontend (or reconnect WebSocket)');
    console.log('   2. Frontend will load empty daily completions list');
    console.log('   3. Repeatable nodes will reset their daily counter');
    
  } catch (error) {
    console.error('❌ Failed to trigger daily reset:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await redis.disconnect();
    process.exit(0);
  }
}

triggerDailyReset();
