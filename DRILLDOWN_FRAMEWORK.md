# Contextual Drilldown Framework - Implementation Guide

## Overview
Platform-wide contextual drilldown framework enabling **Observe → Investigate → Diagnose → Act** workflow across all visual components in the Autonomous IT Operations platform.

## Core Principle
**Every visual element must be clickable and lead to relevant investigation.**

No metric, chart, graph node, table row, heatmap tile, service card, infrastructure component, API endpoint, pod, server, dependency node, incident indicator, KPI card, or status badge should be static.

## Architecture

### 1. Reusable Components

#### `DrilldownDrawer.tsx`
Full-screen side drawer for detailed investigation.

**Features:**
- Responsive (full width on mobile, 40-50% on desktop)
- Health-based styling
- Action buttons
- Breadcrumb support
- Type-specific icons

**Usage:**
```tsx
<DrilldownDrawer
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Payment Authorization Service"
  subtitle="payment-authorization"
  type="service"
  health="warning"
  actions={<>
    <DrilldownButton onClick={runRCA}>Run RCA</DrilldownButton>
    <DrilldownButton onClick={checkBlast} variant="secondary">
      Blast Radius
    </DrilldownButton>
  </>}
>
  {/* Content */}
</DrilldownDrawer>
```

#### `AIInsightsPanel.tsx`
Contextual AI-driven insights based on entity health.

**Auto-generates insights for:**
- **Critical**: Diagnosis, correlation, prediction with urgent actions
- **Warning**: Early warnings, proactive recommendations
- **Healthy**: Optimization suggestions, monitoring recommendations

**Features:**
- Confidence scoring
- Suggested actions
- Pattern matching
- Historical correlation

#### `RelatedResourcesPanel.tsx`
Shows upstream/downstream dependencies and relationships.

**Features:**
- Clickable resource cards
- Health indicators
- Relationship badges (upstream/downstream/peer)
- Quick metrics preview
- Navigation to related entities

#### `IncidentContextPanel.tsx`
Active incidents and alerts related to the entity.

**Features:**
- Severity badges
- Status indicators
- Clickable incident links
- Alert correlation
- Timeline information

### 2. Entity Detail Pages

#### `ServiceDetailPage.tsx`
Full investigation page for services.

**Sections:**
1. **Header**: Service name, health, quick actions
2. **Key Metrics**: Latency, Error Rate, Throughput, Availability
3. **Trend Charts**: 24h latency, error rate, traffic volume
4. **Recent Deployments**: Change correlation
5. **AI Insights**: Contextual recommendations
6. **Incidents & Alerts**: Active issues
7. **Dependencies**: Related resources
8. **SLA Impact**: Compliance tracking

**Route:** `/services/:serviceId`

### 3. Clickable Components

#### Service Health Table
```tsx
<Link to={`/services/${service.id}`}>
  {service.name}
</Link>
```

#### Resource Heatmap Tiles
Already implemented with click → detail panel

#### Dependency Graph Nodes
```tsx
<Node onClick={() => navigate(`/nodes/${node.id}`)} />
```

#### API Endpoints
```tsx
<Link to={`/apis/${endpoint.id}`}>
  {endpoint.path}
</Link>
```

#### Infrastructure Components
```tsx
<ResourceTile onClick={() => openDrawer(resource)} />
```

## Navigation Flow

### Breadcrumb Pattern
```
Home → Service Operations → Payment Service → Incident #INC-1023
```

Implemented in all detail pages:
```tsx
<div className="breadcrumb">
  <Link to="/">Home</Link>
  <span>/</span>
  <Link to="/operations">Service Operations</Link>
  <span>/</span>
  <span>{currentPage}</span>
</div>
```

### Back Navigation
All detail pages include:
```tsx
<button onClick={() => navigate(-1)}>
  <ArrowLeft /> Back
</button>
```

## Drilldown Patterns

### Pattern 1: Table Row → Detail Page
**Example:** Service Health Table
- Click service name → Navigate to `/services/:serviceId`
- Shows full service investigation page

### Pattern 2: Heatmap Tile → Modal/Drawer
**Example:** Resource Heatmap
- Click tile → Open detail panel
- Shows metrics, AI insights, related resources
- Option to navigate to full page

### Pattern 3: Graph Node → Investigation Panel
**Example:** Dependency Graph
- Click node → Open node investigation drawer
- Shows dependencies, health, incidents
- Quick actions (RCA, Blast Radius)

### Pattern 4: KPI Card → Supporting Metrics
**Example:** Executive Dashboard
- Click "Active Incidents" → Navigate to `/incidents`
- Click "Services at Risk" → Navigate to `/operations?filter=risk`

### Pattern 5: Alert/Incident → Context View
**Example:** Alert List
- Click alert → Open incident context panel
- Shows related services, root cause, blast radius
- Quick remediation actions

## Implementation Checklist

### ✅ Completed
- [x] Resource Heatmap with drilldown
- [x] DrilldownDrawer component
- [x] AIInsightsPanel component
- [x] RelatedResourcesPanel component
- [x] IncidentContextPanel component
- [x] ServiceDetailPage with full investigation
- [x] Breadcrumb navigation
- [x] Service table clickable rows
- [x] Route configuration

### 🚧 In Progress
- [ ] Dependency graph node click handlers
- [ ] API endpoint detail pages
- [ ] Infrastructure component drilldown
- [ ] Pod/Container detail views
- [ ] Database detail pages
- [ ] Queue detail pages

### 📋 Pending
- [ ] Incident detail pages
- [ ] Alert detail views
- [ ] Node investigation pages
- [ ] Context menus (right-click)
- [ ] Keyboard shortcuts
- [ ] Search-driven navigation
- [ ] Recent views history

## API Integration Points

### Required API Endpoints
```typescript
// Service details
GET /api/services/:serviceId
GET /api/services/:serviceId/metrics
GET /api/services/:serviceId/incidents
GET /api/services/:serviceId/dependencies
GET /api/services/:serviceId/deployments

// Infrastructure details
GET /api/infrastructure/:resourceId
GET /api/infrastructure/:resourceId/metrics
GET /api/infrastructure/:resourceId/alerts

// Node investigation
GET /api/nodes/:nodeId
GET /api/nodes/:nodeId/paths
GET /api/nodes/:nodeId/incidents

// AI insights
POST /api/ai/investigate
POST /api/ai/diagnose
POST /api/ai/recommend
```

## User Experience Goals

### Immediate Value
- **1 click** to see detailed metrics
- **2 clicks** to start investigation
- **3 clicks** to execute remediation

### Context Preservation
- Breadcrumbs show navigation path
- Back button returns to previous view
- State preserved across navigation

### Progressive Disclosure
- **Level 1**: Overview (dashboard)
- **Level 2**: Entity details (service page)
- **Level 3**: Deep investigation (RCA, blast radius)
- **Level 4**: Remediation (execute fixes)

### Visual Feedback
- Hover states on all clickable elements
- Loading indicators during navigation
- Success/error feedback on actions
- Real-time updates where applicable

## Design Patterns

### Hover State
```css
.clickable-element:hover {
  cursor: pointer;
  background: hover-color;
  transform: translateY(-1px);
  box-shadow: elevated;
}
```

### Click Interaction
```tsx
<div 
  onClick={handleClick}
  className="cursor-pointer transition-all hover:shadow-lg"
>
  {content}
</div>
```

### Loading State
```tsx
{isLoading ? (
  <Spinner />
) : (
  <DetailView data={data} />
)}
```

## Accessibility

### Keyboard Navigation
- Tab through clickable elements
- Enter/Space to activate
- Escape to close drawers/modals
- Arrow keys for navigation

### Screen Readers
- Semantic HTML (buttons, links, nav)
- ARIA labels for interactive elements
- Focus management on modal open/close
- Descriptive link text

### Visual Indicators
- Not color-only (icons + text)
- High contrast ratios
- Focus visible styles
- Loading announcements

## Performance Considerations

### Lazy Loading
- Detail pages load on demand
- Charts render progressively
- Images/heavy content deferred

### Caching
- Cache entity details
- Reuse fetched data
- Invalidate on updates

### Optimistic UI
- Show loading states immediately
- Update UI before API response
- Rollback on error

## Future Enhancements

1. **Context Menus**: Right-click for quick actions
2. **Keyboard Shortcuts**: Power user navigation
3. **Search Integration**: Jump to any entity
4. **Recent Views**: Quick access to history
5. **Favorites**: Pin frequently accessed entities
6. **Comparison Mode**: Side-by-side entity comparison
7. **Export**: Download investigation reports
8. **Collaboration**: Share investigation links
9. **Annotations**: Add notes to entities
10. **Workflows**: Custom investigation paths

## Testing Strategy

### Unit Tests
- Component rendering
- Click handlers
- Navigation logic
- State management

### Integration Tests
- End-to-end flows
- API integration
- Route transitions
- Data loading

### User Testing
- Task completion time
- Navigation clarity
- Information findability
- Action discoverability

## Conclusion

The Contextual Drilldown Framework transforms the platform from a passive monitoring tool into an active investigation and remediation system. Every visual element becomes an entry point into deeper analysis, enabling SREs and operations teams to move seamlessly from observation to action.

**Key Success Metrics:**
- Time to investigation: < 5 seconds
- Clicks to remediation: < 3
- Context retention: 100%
- User satisfaction: High