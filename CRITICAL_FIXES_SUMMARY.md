# Critical Fixes for Node Saving and User Isolation Issues

## 🔍 Issues Fixed

### Issue 1: Nodes with linkedNodeIds Not Being Saved
**Symptoms:** 
- Nodes with children were not being saved properly
- LinkedNodeIds connections were lost during save operations

**Root Cause:**
- `linkedNodeIds` is an MST (MobX-State-Tree) Map type
- MST maps are not automatically serialized to plain objects
- `interceptNodeAdd()` and `interceptNodeUpdate()` were not extracting linkedNodeIds from the map

**Fix Location:** [`graphy/stores/mixins/OptimisticIntegration.js`](graphy/stores/mixins/OptimisticIntegration.js)

**Changes:**
1. Added linkedNodeIds serialization in `interceptNodeAdd()` (line ~240):
   ```javascript
   // Serialize linkedNodeIds from MST map to plain object
   const linkedNodeIdsObj = {};
   if (node.linkedNodeIds) {
     node.linkedNodeIds.forEach((value, key) => {
       linkedNodeIdsObj[key] = value.slice(); // Copy array
     });
   }
   ```

2. Added linkedNodeIds serialization in `interceptNodeUpdate()` (line ~275):
   ```javascript
   // Serialize linkedNodeIds if present in updates
   if (updates.linkedNodeIds) {
     const linkedNodeIdsObj = {};
     updates.linkedNodeIds.forEach((value, key) => {
       linkedNodeIdsObj[key] = value.slice();
     });
     serializedUpdates.linkedNodeIds = linkedNodeIdsObj;
   }
   ```

3. Added children array serialization with linkedNodeIds:
   ```javascript
   // Serialize children array (convert MST nodes to plain objects)
   if (updates.children && Array.isArray(updates.children)) {
     serializedUpdates.children = updates.children.map(child => {
       if (child.linkedNodeIds) {
         const childLinkedIds = {};
         child.linkedNodeIds.forEach((value, key) => {
           childLinkedIds[key] = value.slice();
         });
         return { ...child, linkedNodeIds: childLinkedIds };
       }
       return child;
     });
   }
   ```

---

### Issue 2: All Users Seeing Same Graph (No User Isolation)
**Symptoms:**
- All users saw identical graph data regardless of their Auth0 identity
- Changes made by one user affected all other users

**Root Cause:**
- `userId` was `undefined` when WebSocket connected
- [`App.jsx`](graphy/App.jsx:31) called `initialize()` BEFORE `setUserId()` completed
- [`OptimisticIntegration.connect()`](graphy/stores/mixins/OptimisticIntegration.js:27) tried to read userId too early
- Backend fell back to `DEFAULT_USER_ID='1'`, causing all users to share `user:1:graph:main`

**Fix Location:** [`graphy/App.jsx`](graphy/App.jsx)

**Changes:**
1. Set userId on window.rootStore BEFORE calling initialize():
   ```javascript
   // CRITICAL: Set userId BEFORE calling initialize
   treeDaoStore.setUserId(user.sub);
   
   // Also set on root store for global access
   if (typeof window !== 'undefined') {
     window.rootStore = window.rootStore || {};
     window.rootStore.userId = user.sub;
     window.rootStore.treeDaoStore = treeDaoStore;
   }
   
   // Now initialize with userId already set
   rootStore.initialize(user.sub);
   ```

**Fix Location:** [`graphy/stores/mixins/OptimisticIntegration.js`](graphy/stores/mixins/OptimisticIntegration.js)

**Changes:**
2. Added diagnostic error logging for missing userId:
   ```javascript
   const userId = window.rootStore?.userId || window.rootStore?.treeDaoStore?.userId;
   
   if (!userId) {
     console.error('❌ OptimisticIntegration: userId is not set!');
     console.error('   This will cause all users to share the same graph data.');
   } else {
     console.log('✅ OptimisticIntegration: Connecting with userId:', userId);
   }
   ```

---

## 📊 Diagnostic Logging Added

### Backend Diagnostics ([`dao_api2/src/simple-server.js`](dao_api2/src/simple-server.js))

1. **WebSocket SUBSCRIBE logging** (line ~600):
   ```javascript
   if (!data.userId) {
     console.error(`⚠️  Client ${clientId} SUBSCRIBE without userId!`);
     console.error(`   Using DEFAULT_USER_ID='${DEFAULT_USER_ID}'`);
     console.error(`   This will cause user isolation failure!`);
   } else {
     console.log(`✅ Client subscribed with userId="${data.userId}"`);
   }
   ```

2. **ADD_NODE linkedNodeIds logging** (line ~230):
   ```javascript
   const linkedIdsCount = Object.keys(newNode.linkedNodeIds).length;
   if (linkedIdsCount > 0) {
     console.log(`🔗 Node has ${linkedIdsCount} linkedNodeIds types`);
     Object.entries(newNode.linkedNodeIds).forEach(([type, ids]) => {
       console.log(`   ${type}: [${ids.join(', ')}]`);
     });
   }
   ```

3. **UPDATE_NODE linkedNodeIds logging** (line ~330):
   ```javascript
   if (payload.updates.linkedNodeIds !== undefined) {
     const linkedIdsCount = Object.keys(node.linkedNodeIds).length;
     console.log(`🔗 Updated linkedNodeIds: ${linkedIdsCount} types`);
   }
   ```

---

## 🧪 Testing Instructions

### Test 1: User Isolation
1. Open app in two different browsers with different Auth0 accounts
2. Create a node in Browser 1
3. **Expected:** Node should NOT appear in Browser 2
4. **Check logs for:** `✅ Client subscribed with userId="auth0|..."`

### Test 2: LinkedNodeIds Persistence  
1. Create a parent node with children
2. Create edges between nodes (creates linkedNodeIds)
3. Reload the page
4. **Expected:** All nodes and their linkedNodeIds connections should persist
5. **Check logs for:** `🔗 Node has X linkedNodeIds connection types`

### Test 3: Children with LinkedNodeIds
1. Create a node with children
2. Add edges to some children
3. Update the parent node
4. **Expected:** Children's linkedNodeIds should be preserved
5. **Check logs for:** `X children have linkedNodeIds`

---

## 🔑 Key Technical Points

1. **MST Map Serialization:**
   - MST maps don't automatically serialize to JSON
   - Must explicitly iterate with `forEach()` and copy values
   - Applies to both `linkedNodeIds` map and arrays within it

2. **Timing Sequence:**
   - Order matters: `setUserId()` → `window.rootStore.userId` → `initialize()` → `connect()`
   - Breaking this sequence causes `userId=undefined` → `DEFAULT_USER_ID='1'`

3. **Redis Key Format:**
   - User-specific: `user:${userId}:graph:${graphId}`
   - Old format (no isolation): `graph:${graphId}`
   - Backend has fallback compatibility but logs warning

---

## 📝 Files Modified

### Frontend (graphy/)
- [`graphy/App.jsx`](graphy/App.jsx) - Fixed userId initialization sequence
- [`graphy/stores/mixins/OptimisticIntegration.js`](graphy/stores/mixins/OptimisticIntegration.js) - Fixed linkedNodeIds serialization + userId logging

### Backend (dao_api2/)
- [`dao_api2/src/simple-server.js`](dao_api2/src/simple-server.js) - Added diagnostic logging

---

## ✅ Success Criteria

Both issues are fixed when:
1. ✅ Different users see completely isolated graphs
2. ✅ Nodes with children persist all linkedNodeIds connections
3. ✅ Backend logs show correct userId (not 'undefined' or DEFAULT_USER_ID)
4. ✅ Backend logs show linkedNodeIds being saved and restored

---

## 🚨 Critical Warnings

**DO NOT:**
- Call `initialize()` before `setUserId()` is complete
- Forget to serialize MST maps when sending via WebSocket
- Use direct property access on MST maps without serialization

**ALWAYS:**
- Set `window.rootStore.userId` before connecting WebSocket
- Use `forEach()` to iterate MST maps for serialization
- Check backend logs for userId=undefined warnings

---

Generated: 2025-10-08