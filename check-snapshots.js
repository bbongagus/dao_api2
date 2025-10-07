import redis from './src/redis.js';

console.log('🔍 Checking Progress Snapshots in Redis...\n');

async function checkSnapshots() {
  try {
    // Get all snapshot keys
    const keys = await redis.keys('progress:daily:*');
    console.log(`📦 Found ${keys.length} snapshot keys in Redis\n`);
    
    if (keys.length === 0) {
      console.log('❌ No snapshots found! This is the problem.');
      console.log('💡 Snapshots should be stored with keys like: progress:daily:{nodeId}');
      return;
    }
    
    // Check each key
    for (const key of keys.slice(0, 5)) { // Check first 5 keys
      console.log(`\n📌 Key: ${key}`);
      const nodeId = key.replace('progress:daily:', '');
      console.log(`   Node ID: ${nodeId}`);
      
      // Get all snapshots for this node
      const snapshots = await redis.zrange(key, 0, -1, 'WITHSCORES');
      
      if (snapshots.length === 0) {
        console.log('   ⚠️  No snapshot data in this key');
        continue;
      }
      
      console.log(`   📊 Snapshots count: ${snapshots.length / 2}`);
      
      // Parse snapshots
      for (let i = 0; i < Math.min(6, snapshots.length); i += 2) {
        try {
          const data = JSON.parse(snapshots[i]);
          const dateKey = snapshots[i + 1];
          
          // Convert dateKey to readable date
          const year = dateKey.substring(0, 4);
          const month = dateKey.substring(4, 6);
          const day = dateKey.substring(6, 8);
          
          console.log(`   📅 Date: ${year}-${month}-${day}`);
          console.log(`      Progress: ${data.progress}%`);
          console.log(`      Timestamp: ${data.timestamp}`);
        } catch (e) {
          console.log('   ❌ Error parsing snapshot:', e.message);
        }
      }
    }
    
    // Check specific dates
    console.log('\n\n🗓️  Checking snapshots for specific dates:');
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const week_ago = new Date(today);
    week_ago.setDate(week_ago.getDate() - 7);
    const month_ago = new Date(today);
    month_ago.setDate(month_ago.getDate() - 30);
    
    const getDateKey = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };
    
    const todayKey = getDateKey(today);
    const yesterdayKey = getDateKey(yesterday);
    const weekAgoKey = getDateKey(week_ago);
    const monthAgoKey = getDateKey(month_ago);
    
    console.log(`\n📅 Today (${todayKey}):`);
    console.log(`📅 Yesterday (${yesterdayKey}):`);
    console.log(`📅 7 days ago (${weekAgoKey}):`);
    console.log(`📅 30 days ago (${monthAgoKey}):`);
    
    // Check if we have snapshots for these dates
    if (keys.length > 0) {
      const sampleKey = keys[0];
      const nodeId = sampleKey.replace('progress:daily:', '');
      
      console.log(`\n🔎 Checking node: ${nodeId}`);
      
      // Check for yesterday's snapshot
      const yesterdayData = await redis.zrangebyscore(
        sampleKey,
        yesterdayKey,
        yesterdayKey
      );
      
      if (yesterdayData.length > 0) {
        const data = JSON.parse(yesterdayData[0]);
        console.log(`✅ Yesterday's snapshot found: ${data.progress}%`);
      } else {
        console.log(`❌ No snapshot for yesterday (${yesterdayKey})`);
      }
      
      // Check for today's snapshot
      const todayData = await redis.zrangebyscore(
        sampleKey,
        todayKey,
        todayKey
      );
      
      if (todayData.length > 0) {
        const data = JSON.parse(todayData[0]);
        console.log(`✅ Today's snapshot found: ${data.progress}%`);
      } else {
        console.log(`❌ No snapshot for today (${todayKey})`);
      }
      
      // Check for week ago
      const weekData = await redis.zrangebyscore(
        sampleKey,
        weekAgoKey,
        weekAgoKey
      );
      
      if (weekData.length > 0) {
        const data = JSON.parse(weekData[0]);
        console.log(`✅ 7 days ago snapshot found: ${data.progress}%`);
      } else {
        console.log(`❌ No snapshot for 7 days ago (${weekAgoKey})`);
      }
    }
    
    // Test creating a snapshot for yesterday
    console.log('\n\n🧪 Creating test snapshot for yesterday...');
    
    // Sample node IDs from your data
    const testNodeIds = [
      '8043a7f4-2770-48cb-b434-57e1d8806819', // Travel
      '52bfa4d9-caa8-47c0-ae87-a22c70978c0d', // Nov 2025
    ];
    
    for (const nodeId of testNodeIds) {
      const snapshotKey = `progress:daily:${nodeId}`;
      
      // Create yesterday's snapshot
      const yesterdaySnapshot = {
        progress: Math.floor(Math.random() * 100), // Random progress for testing
        completions: 0,
        total: 1,
        timestamp: yesterday.toISOString(),
        date: yesterdayKey
      };
      
      await redis.zadd(snapshotKey, yesterdayKey, JSON.stringify(yesterdaySnapshot));
      console.log(`✅ Created yesterday's snapshot for ${nodeId}: ${yesterdaySnapshot.progress}%`);
      
      // Also create one for 7 days ago
      const weekSnapshot = {
        progress: Math.floor(Math.random() * 100),
        completions: 0,
        total: 1,
        timestamp: week_ago.toISOString(),
        date: weekAgoKey
      };
      
      await redis.zadd(snapshotKey, weekAgoKey, JSON.stringify(weekSnapshot));
      console.log(`✅ Created 7-days-ago snapshot for ${nodeId}: ${weekSnapshot.progress}%`);
      
      // And 30 days ago
      const monthSnapshot = {
        progress: Math.floor(Math.random() * 100),
        completions: 0,
        total: 1,
        timestamp: month_ago.toISOString(),
        date: monthAgoKey
      };
      
      await redis.zadd(snapshotKey, monthAgoKey, JSON.stringify(monthSnapshot));
      console.log(`✅ Created 30-days-ago snapshot for ${nodeId}: ${monthSnapshot.progress}%`);
    }
    
    console.log('\n📊 Test snapshots created! Now trends should work.');
    console.log('🔄 Try refreshing the dashboard and checking for trends.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await redis.quit();
  }
}

checkSnapshots();