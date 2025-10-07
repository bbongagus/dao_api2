import redis from './src/redis.js';

async function debugRedis() {
  console.log('🔍 Checking Redis for graph data...\n');
  
  try {
    // Check all keys
    const allKeys = await redis.keys('*');
    console.log('📦 All Redis keys:', allKeys);
    console.log(`   Total: ${allKeys.length} keys\n`);
    
    // Check for graph keys specifically
    const graphKeys = allKeys.filter(key => key.includes('graph'));
    console.log('📊 Graph-related keys found:', graphKeys);
    console.log('');
    
    // Check data type and content for each graph key
    for (const key of graphKeys) {
      console.log(`\n🔎 Checking key: ${key}`);
      
      // Get the type of the key
      const type = await redis.type(key);
      console.log(`   Type: ${type}`);
      
      try {
        if (type === 'string') {
          const data = await redis.get(key);
          if (data) {
            try {
              const parsed = JSON.parse(data);
              console.log(`   ✅ Found graph with ${parsed.nodes?.length || 0} nodes`);
              if (parsed.nodes && parsed.nodes.length > 0) {
                console.log(`   📝 Sample node:`, {
                  id: parsed.nodes[3].id,
                  title: parsed.nodes[3].title,
                  isDone: parsed.nodes[3].isDone,
                  currentCompletions: parsed.nodes[3].currentCompletions
                });
              }
            } catch (e) {
              console.log('   ⚠️ Value is not valid JSON');
            }
          }
        } else if (type === 'hash') {
          const hashData = await redis.hGetAll(key);
          console.log(`   📋 Hash contains ${Object.keys(hashData).length} fields`);
          console.log(`   Fields:`, Object.keys(hashData));
          
          // Try to parse the 'data' field if it exists
          if (hashData.data) {
            try {
              const parsed = JSON.parse(hashData.data);
              console.log(`   ✅ Found graph in 'data' field with ${parsed.nodes?.length || 0} nodes`);
            } catch (e) {
              console.log('   ⚠️ Hash data field is not valid JSON');
            }
          }
        } else {
          console.log(`   ℹ️ Unsupported type for graph data: ${type}`);
        }
      } catch (err) {
        console.log(`   ❌ Error reading key: ${err.message}`);
      }
    }
    
    // Check what key the snapshot service is looking for
    console.log('\n\n📸 Snapshot service expects to find:');
    console.log('   - graph:main (string with JSON)');
    console.log('   - user:test-user-001:graph:main (string with JSON)');
    
    // Try these specific keys
    console.log('\n🔍 Checking expected keys:');
    
    for (const expectedKey of ['graph:main', 'user:test-user-001:graph:main']) {
      const exists = await redis.exists(expectedKey);
      if (exists) {
        const type = await redis.type(expectedKey);
        console.log(`   ${expectedKey}:`);
        console.log(`      ✅ EXISTS (type: ${type})`);
        
        if (type === 'string') {
          const data = await redis.get(expectedKey);
          try {
            const parsed = JSON.parse(data);
            console.log(`      📊 Contains ${parsed.nodes?.length || 0} nodes`);
          } catch (e) {
            console.log(`      ⚠️ Not valid JSON`);
          }
        } else if (type === 'hash') {
          const hashData = await redis.hGetAll(expectedKey);
          console.log(`      📋 Hash with fields: ${Object.keys(hashData).join(', ')}`);
        }
      } else {
        console.log(`   ${expectedKey}: ❌ NOT FOUND`);
      }
    }
    
    // Check analytics keys
    console.log('\n\n📈 Analytics keys:');
    const analyticsKeys = allKeys.filter(key => key.includes('analytics'));
    if (analyticsKeys.length > 0) {
      for (const key of analyticsKeys) {
        const type = await redis.type(key);
        console.log(`   ${key} (${type})`);
      }
    } else {
      console.log('   No analytics keys found');
    }
    
    console.log('\n✅ Debug complete!\n');
    
  } catch (err) {
    console.error('❌ Error during debug:', err);
  }
  
  process.exit(0);
}

debugRedis().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});