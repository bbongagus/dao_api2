# 🧪 Advanced Analytics Testing Guide

## Prerequisites

1. **Backend Services Running:**
   ```bash
   # Terminal 1 - Redis
   redis-server
   
   # Terminal 2 - Backend
   cd dao_api2
   npm run dev
   ```

2. **Frontend Running:**
   ```bash
   # Terminal 3
   cd graphy
   npm run dev
   ```

## Testing Scenarios

### 1. Category Progress Cards with Trends

**Setup:**
1. Create at least 2-3 fundamental category nodes
2. Add child nodes to each category
3. Mark some progress on different nodes

**Test Steps:**
1. Navigate to the dashboard
2. Verify category cards are displayed at the top
3. Check that each card shows:
   - Category name and emoji
   - Progress percentage
   - Trend indicator (↑/↓/→)
   - Trend percentage ("23% this week")
   - Task completion stats (e.g., "3/10")
   - Focus time

**Expected Results:**
- Cards should update in real-time when progress changes
- Trend calculations should be accurate
- Hover effects should work (elevation and border highlight)

### 2. Period Selector

**Test Steps:**
1. Look for the period selector above the category cards
2. Click through each option:
   - Today
   - 7 days
   - 30 days
   - All time

**Expected Results:**
- All analytics should refresh when period changes
- Selected period should be highlighted
- Data should be filtered correctly for each period

### 3. Recent Activity Focus

**Setup:**
1. Work on several different nodes
2. Make progress updates on at least 5 nodes

**Test Steps:**
1. Check the "Recent Activity Focus" panel
2. Verify it shows the 5 most recently active nodes
3. Check each item displays:
   - Node emoji and title
   - Status badge (Most active path, Steady progress, etc.)
   - Progress metrics (tasks completed/advanced)
   - Focus time
   - Time since last activity
   - Circular progress indicator

**Expected Results:**
- List should update when you work on different nodes
- Status badges should reflect actual activity
- Click on items should navigate to that node

### 4. Effort Distribution

**Test Steps:**
1. Check the "Effort Distribution" donut chart
2. Verify it shows:
   - Donut chart with category breakdown
   - Center label showing "X% allocated"
   - Legend with category names and percentages
   - Total time and category count
   - Available capacity bar

**Expected Results:**
- Chart should show proportional distribution
- Hover tooltips should work
- Colors should be consistent with category colors

### 5. Approaching Completion

**Setup:**
1. Get several nodes to >70% progress but not 100%

**Test Steps:**
1. Check the "Approaching Completion" section
2. Verify each card shows:
   - Circular progress indicator
   - Node title and emoji
   - Priority label (Almost there!, Final push, etc.)
   - Remaining steps count
   - Category association
   - "Complete Now" button

**Expected Results:**
- Only nodes between 70-99% should appear
- Sorted by progress (highest first)
- Click should navigate to the node

## API Testing

### Test Backend Endpoints

```bash
# Get category analytics
curl http://localhost:3001/api/analytics/categories/dao-graph-001?period=7d \
  -H "X-User-ID: test-user-001"

# Get recent activity focus
curl http://localhost:3001/api/analytics/recent-focus/dao-graph-001?period=7d&limit=5 \
  -H "X-User-ID: test-user-001"

# Get effort distribution
curl http://localhost:3001/api/analytics/effort-distribution/dao-graph-001?period=7d \
  -H "X-User-ID: test-user-001"

# Get nodes near completion
curl http://localhost:3001/api/analytics/near-completion/dao-graph-001?threshold=0.7 \
  -H "X-User-ID: test-user-001"
```

## Performance Testing

### Load Testing
1. Create a graph with 100+ nodes
2. Generate activity on 50+ nodes
3. Check dashboard load time (should be <2s)
4. Verify smooth animations

### Real-time Updates
1. Open dashboard in multiple browser tabs
2. Make progress updates in one tab
3. Verify all tabs update within 1-2 seconds

## Edge Cases to Test

### Empty States
1. **No categories:** Verify empty state message
2. **No recent activity:** Check placeholder content
3. **No effort data:** Ensure graceful handling
4. **No near-complete nodes:** Verify helpful message

### Data Scenarios
1. **Single category:** Should still show cards
2. **100% completion:** Nodes should not appear in "Approaching"
3. **0% progress:** Should not affect trend calculations
4. **Period with no data:** Should show 0% trends

## Visual Testing

### Dark Theme
- All components should use DAO color palette
- Text should be readable (proper contrast)
- Hover states should be visible
- Charts should be clearly visible

### Responsive Design
1. Test on desktop (1920x1080)
2. Test on laptop (1366x768)
3. Test on tablet (768x1024)
4. Test on mobile (375x667)

**Check:**
- Cards stack properly on smaller screens
- Charts resize appropriately
- Text remains readable
- Navigation still works

## Console Checks

Open browser console and verify:
- No JavaScript errors
- No failed API requests
- Analytics events are being tracked
- WebSocket connection is stable

## Common Issues & Solutions

### Issue: Analytics not loading
**Solution:** Check Redis is running and has data

### Issue: Trends showing 0%
**Solution:** Wait for period to have comparison data

### Issue: Empty category cards
**Solution:** Ensure nodes have nodeType='fundamental' and nodeSubtype='category'

### Issue: Slow performance
**Solution:** Check for excessive re-renders, optimize API calls

## Success Criteria

✅ All components render without errors
✅ Data updates in real-time
✅ Period selector changes all metrics
✅ Navigation works from all clickable elements
✅ Empty states handle gracefully
✅ Performance is smooth (<2s load time)
✅ Mobile responsive design works
✅ No console errors
✅ Analytics tracking is working
✅ Trends calculate correctly

## Testing Commands

```bash
# Run backend tests (if available)
cd dao_api2
npm test

# Check Redis data
redis-cli
> KEYS analytics:*
> XRANGE analytics:stream:test-user-001:dao-graph-001 - +

# Monitor WebSocket connections
# Check browser DevTools > Network > WS tab

# Performance monitoring
# Check browser DevTools > Performance tab
```

This completes the advanced analytics implementation. The dashboard now provides comprehensive insights into task progress, activity patterns, and effort distribution.