# AI Pharmacy OS — Complete Project Documentation

> **Auto-generated from the project knowledge graph** (`.understand-anything/knowledge-graph.json`). Do not edit by hand — run `node scripts/generate-project-docs.mjs` after `node scripts/quick-update.mjs` to refresh.

## Project Overview

| Attribute | Value |
|---|---|
| **Name** | AI Pharmacy OS |
| **Description** | Unified pharmacy management platform. |
| **Languages** | typescript, javascript, json, markdown, html, css |
| **Frameworks** | Express.js, React, Vite, Tailwind CSS, React Native, Expo |
| **Analyzed At** | 2026-09-22T16:45:53.251Z |
| **Git Commit** | `3127e9ea857a9860770ad0e80ae0fc64504cccf8` |
| **Graph Nodes (total)** | 1028 |
| **Graph Edges (total)** | 518 |
| **Documented Nodes (excl. vendored/caches)** | 1028 |
| **Documented Edges (excl. vendored/caches)** | 518 |

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Layers](#architecture-layers)
3. [File Inventory by Layer](#file-inventory-by-layer)
4. [Node Type Breakdown](#node-type-breakdown)
5. [Dependency Graph (imports)](#dependency-graph-imports)
6. [Automation and Background Timers](#automation-and-background-timers)
7. [Configuration & Environment](#configuration-and-environment)

## Architecture Layers

| Layer | Description | Files (doc.) |
|---|---|---|
| **Configuration Layer** `layer:configuration` | Package configs | 220 |
| **Documentation Layer** `layer:documentation` | Docs and specs | 14 |
| **Presentation Layer** `layer:presentation` | Frontend React SPA | 144 |
| **Mobile Layer** `layer:mobile` | React Native Expo app | 66 |
| **Script Layer** `layer:scripts` | CLI tools and scripts | 224 |
| **Infrastructure Layer** `layer:infrastructure` | Middleware and workers | 26 |
| **API Layer** `layer:api` | Express.js route handlers | 58 |
| **Service Layer** `layer:service` | Business logic services | 92 |
| **Testing Layer** `layer:testing` | Test files | 115 |
| **Data Layer** `layer:data` | Database and data files | 69 |

## File Inventory by Layer

All project files (vendored `.venv`/`node_modules`/build caches excluded). Each entry shows the node id, type, role summary, and tags. File names link to their repository path.

### Presentation Layer — `layer:presentation`

<small style="color:#ec4899">144 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `frontend/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` `frontend` |
| 2 | `frontend/eslint.config.js` | `file` | Source file: eslint.config.js | `frontend` |
| 3 | `frontend/index.html` | `file` | Source file: index.html | `frontend` |
| 4 | `frontend/package.json` | `config` | Configuration: package.json | `config` `frontend` |
| 5 | `frontend/postcss.config.js` | `file` | Source file: postcss.config.js | `frontend` |
| 6 | `frontend/public/manifest.json` | `config` | Configuration: manifest.json | `config` `frontend` |
| 7 | `frontend/public/products/all_downloaded_images_conflict_report.json` | `config` | Configuration: all_downloaded_images_conflict_report.json | `config` `frontend` |
| 8 | `frontend/public/robots.txt` | `file` | Source file: robots.txt | `frontend` |
| 9 | `frontend/README.md` | `document` | Documentation: README.md | `documentation` `frontend` |
| 10 | `frontend/src/api/authApi.ts` | `file` | Source file: authApi.ts | `auth` `frontend` |
| 11 | `frontend/src/api/catalogApi.ts` | `file` | Source file: catalogApi.ts | `frontend` |
| 12 | `frontend/src/api/client.ts` | `file` | Source file: client.ts | `frontend` |
| 13 | `frontend/src/api/customerApi.ts` | `file` | Source file: customerApi.ts | `frontend` |
| 14 | `frontend/src/api/pricingApi.ts` | `file` | Source file: pricingApi.ts | `frontend` |
| 15 | `frontend/src/App.css` | `file` | Source file: App.css | `frontend` |
| 16 | `frontend/src/App.tsx` | `file` | Source file: App.tsx | `frontend` |
| 17 | `frontend/src/components/AICamera.tsx` | `file` | React component | `frontend` |
| 18 | `frontend/src/components/AutomationHubPopover.tsx` | `file` | React component | `frontend` |
| 19 | `frontend/src/components/BackupCenterModal.tsx` | `file` | React component | `frontend` |
| 20 | `frontend/src/components/CompositionIntelligenceModal.tsx` | `file` | React component | `frontend` |
| 21 | `frontend/src/components/ConnectedDevicesFooterBar.tsx` | `file` | React component | `frontend` |
| 22 | `frontend/src/components/DateRangeFilter.tsx` | `file` | React component | `frontend` |
| 23 | `frontend/src/components/DelayNoticeModal.tsx` | `file` | React component | `frontend` |
| 24 | `frontend/src/components/DispatchWhatsAppProgressCard.tsx` | `file` | React component | `frontend` |
| 25 | `frontend/src/components/ErrorBoundary.tsx` | `file` | React component | `frontend` |
| 26 | `frontend/src/components/HoverPriceIntelTable.tsx` | `file` | React component | `frontend` |
| 27 | `frontend/src/components/InfiniteScrollStatus.tsx` | `file` | React component | `frontend` |
| 28 | `frontend/src/components/InfiniteTable.tsx` | `file` | React component | `frontend` |
| 29 | `frontend/src/components/Layout.tsx` | `file` | React component | `frontend` |
| 30 | `frontend/src/components/LiveCartAddModal.tsx` | `file` | React component | `frontend` |
| 31 | `frontend/src/components/MobileConnectionModal.tsx` | `file` | React component | `frontend` |
| 32 | `frontend/src/components/PharmarackCartCalendar.tsx` | `file` | React component | `frontend` |
| 33 | `frontend/src/components/PhoneInputWithBadge.tsx` | `file` | React component | `frontend` |
| 34 | `frontend/src/components/PortalAccountsManager.tsx` | `file` | React component | `frontend` |
| 35 | `frontend/src/components/POS/BrandBanner.tsx` | `file` | React component | `frontend` |
| 36 | `frontend/src/components/PrescriptionUploadModal.tsx` | `file` | React component | `frontend` |
| 37 | `frontend/src/components/PriceIntelPanel.tsx` | `file` | React component | `frontend` |
| 38 | `frontend/src/components/PurchaseSaveVerificationModal.tsx` | `file` | React component | `frontend` |
| 39 | `frontend/src/components/QuickAssistOrderEditModal.tsx` | `file` | React component | `frontend` |
| 40 | `frontend/src/components/QuickOrderModal.tsx` | `file` | React component | `frontend` |
| 41 | `frontend/src/components/SalutationNameInput.tsx` | `file` | React component | `frontend` |
| 42 | `frontend/src/components/SaveBillSpecialPriceModal.tsx` | `file` | React component | `frontend` |
| 43 | `frontend/src/components/SpecialOrderArrivalModal.tsx` | `file` | React component | `frontend` |
| 44 | `frontend/src/components/StagedQueueFloatingWidget.tsx` | `file` | React component | `frontend` |
| 45 | `frontend/src/components/StagedReviewModal.tsx` | `file` | React component | `frontend` |
| 46 | `frontend/src/components/StoreSelector.tsx` | `file` | React component | `frontend` |
| 47 | `frontend/src/components/UniversalMedicineEditModal.tsx` | `file` | React component | `frontend` |
| 48 | `frontend/src/components/UpdateBanner.tsx` | `file` | React component | `frontend` |
| 49 | `frontend/src/components/VirtualRow.tsx` | `file` | React component | `frontend` |
| 50 | `frontend/src/components/WhatsAppQueuePopover.tsx` | `file` | React component | `frontend` |
| 51 | `frontend/src/context/StoreContext.tsx` | `file` | Source file: StoreContext.tsx | `frontend` |
| 52 | `frontend/src/hooks/useApiQuery.ts` | `file` | Source file: useApiQuery.ts | `frontend` |
| 53 | `frontend/src/hooks/useDeferredEffect.ts` | `file` | Source file: useDeferredEffect.ts | `frontend` |
| 54 | `frontend/src/hooks/useFetchMode.ts` | `file` | Source file: useFetchMode.ts | `frontend` |
| 55 | `frontend/src/hooks/useGlobalSseInvalidation.ts` | `file` | Source file: useGlobalSseInvalidation.ts | `frontend` |
| 56 | `frontend/src/hooks/useInfiniteScroll.ts` | `file` | Source file: useInfiniteScroll.ts | `frontend` |
| 57 | `frontend/src/hooks/useOnClickOutside.ts` | `file` | Source file: useOnClickOutside.ts | `frontend` |
| 58 | `frontend/src/hooks/usePersistedDateRange.ts` | `file` | Source file: usePersistedDateRange.ts | `frontend` |
| 59 | `frontend/src/hooks/usePWAInstall.ts` | `file` | Source file: usePWAInstall.ts | `frontend` |
| 60 | `frontend/src/hooks/useSettingsQuery.ts` | `file` | Source file: useSettingsQuery.ts | `frontend` |
| 61 | `frontend/src/hooks/useVirtualizer.ts` | `file` | Source file: useVirtualizer.ts | `frontend` |
| 62 | `frontend/src/hooks/useWaPhoneStatus.ts` | `file` | Source file: useWaPhoneStatus.ts | `frontend` |
| 63 | `frontend/src/index.css` | `file` | Source file: index.css | `frontend` |
| 64 | `frontend/src/lib/keepAlive/KeepAliveOutlet.tsx` | `file` | Source file: KeepAliveOutlet.tsx | `frontend` |
| 65 | `frontend/src/lib/keepAlive/PageActiveContext.tsx` | `file` | Source file: PageActiveContext.tsx | `frontend` |
| 66 | `frontend/src/lib/keepAlive/PageErrorBoundary.tsx` | `file` | Source file: PageErrorBoundary.tsx | `frontend` |
| 67 | `frontend/src/lib/keepAlive/PageQueryTracker.tsx` | `file` | Source file: PageQueryTracker.tsx | `frontend` |
| 68 | `frontend/src/lib/keepAlive/routePool.ts` | `file` | Source file: routePool.ts | `frontend` |
| 69 | `frontend/src/lib/pageImports.ts` | `file` | Source file: pageImports.ts | `frontend` |
| 70 | `frontend/src/lib/queryClient.ts` | `file` | Source file: queryClient.ts | `frontend` |
| 71 | `frontend/src/main.tsx` | `file` | Source file: main.tsx | `frontend` |
| 72 | `frontend/src/pages/AIEngineering/index.tsx` | `file` | React page component | `frontend` |
| 73 | `frontend/src/pages/AIEngineering/panels/CompliancePanel.tsx` | `file` | React page component | `frontend` |
| 74 | `frontend/src/pages/AIEngineering/panels/CompositionPanel.tsx` | `file` | React page component | `frontend` |
| 75 | `frontend/src/pages/AIEngineering/panels/ScheduleDrugsPanel.tsx` | `file` | React page component | `frontend` |
| 76 | `frontend/src/pages/AIEngineering/panels/ScheduleResearchModal.tsx` | `file` | React page component | `frontend` |
| 77 | `frontend/src/pages/AIEngineering/panels/ScheduleReviewQueue.tsx` | `file` | React page component | `frontend` |
| 78 | `frontend/src/pages/AIEngineering/WaRequestsPanel.tsx` | `file` | React page component | `frontend` |
| 79 | `frontend/src/pages/AuditCenter/index.tsx` | `file` | React page component | `frontend` |
| 80 | `frontend/src/pages/CatalogUpload/index.tsx` | `file` | React page component | `frontend` |
| 81 | `frontend/src/pages/CRM/EnquiriesSection.tsx` | `file` | React page component | `frontend` |
| 82 | `frontend/src/pages/CRM/index.tsx` | `file` | React page component | `frontend` |
| 83 | `frontend/src/pages/CustomerPortal/index.tsx` | `file` | React page component | `frontend` |
| 84 | `frontend/src/pages/CustomerPortal/PublicCatalogView.tsx` | `file` | React page component | `frontend` |
| 85 | `frontend/src/pages/CustomerReturn/index.tsx` | `file` | React page component | `frontend` |
| 86 | `frontend/src/pages/CustomerReturnHistory/index.tsx` | `file` | React page component | `frontend` |
| 87 | `frontend/src/pages/Dashboard/index.tsx` | `file` | React page component | `frontend` |
| 88 | `frontend/src/pages/Database/CatalogImageVerificationTab.tsx` | `file` | React page component | `frontend` |
| 89 | `frontend/src/pages/Database/index.tsx` | `file` | React page component | `frontend` |
| 90 | `frontend/src/pages/Dispatch/index.tsx` | `file` | React page component | `frontend` |
| 91 | `frontend/src/pages/Expiry/index.tsx` | `file` | React page component | `frontend` |
| 92 | `frontend/src/pages/Inventory/index.tsx` | `file` | React page component | `frontend` |
| 93 | `frontend/src/pages/Investigation/index.tsx` | `file` | React page component | `frontend` |
| 94 | `frontend/src/pages/Learning/index.tsx` | `file` | React page component | `frontend` |
| 95 | `frontend/src/pages/LiveCart/index.tsx` | `file` | React page component | `frontend` |
| 96 | `frontend/src/pages/Mail/index.tsx` | `file` | React page component | `frontend` |
| 97 | `frontend/src/pages/Migration/components/ColumnMapper.tsx` | `file` | React page component | `frontend` |
| 98 | `frontend/src/pages/Migration/components/ErrorRows.tsx` | `file` | React page component | `frontend` |
| 99 | `frontend/src/pages/Migration/components/LocalBackupPanel.tsx` | `file` | React page component | `frontend` |
| 100 | `frontend/src/pages/Migration/components/ModuleSection.tsx` | `file` | React page component | `frontend` |
| 101 | `frontend/src/pages/Migration/components/RedBookUploader.tsx` | `file` | React page component | `frontend` |
| 102 | `frontend/src/pages/Migration/components/ReviewModal.tsx` | `file` | React page component | `frontend` |
| 103 | `frontend/src/pages/Migration/index.tsx` | `file` | React page component | `frontend` |
| 104 | `frontend/src/pages/OnlineCatalog/index.tsx` | `file` | React page component | `frontend` |
| 105 | `frontend/src/pages/PharmarackCart/index.tsx` | `file` | React page component | `frontend` |
| 106 | `frontend/src/pages/PhoneSales/index.tsx` | `file` | React page component | `frontend` |
| 107 | `frontend/src/pages/POS/index.tsx` | `file` | React page component | `frontend` |
| 108 | `frontend/src/pages/PurchaseHistory/index.tsx` | `file` | React page component | `frontend` |
| 109 | `frontend/src/pages/Purchases/index.tsx` | `file` | React page component | `frontend` |
| 110 | `frontend/src/pages/Reports/index.tsx` | `file` | React page component | `frontend` |
| 111 | `frontend/src/pages/Returns/ExpiryReturnReview.tsx` | `file` | React page component | `frontend` |
| 112 | `frontend/src/pages/Returns/index.tsx` | `file` | React page component | `frontend` |
| 113 | `frontend/src/pages/Sells/index.tsx` | `file` | React page component | `frontend` |
| 114 | `frontend/src/pages/Settings/index.tsx` | `file` | React page component | `frontend` |
| 115 | `frontend/src/pages/WebsiteOrders/index.tsx` | `file` | React page component | `frontend` |
| 116 | `frontend/src/services/api.ts` | `file` | Source file: api.ts | `frontend` |
| 117 | `frontend/src/services/dataFetchControl.ts` | `file` | Source file: dataFetchControl.ts | `frontend` |
| 118 | `frontend/src/services/events.ts` | `file` | Source file: events.ts | `frontend` |
| 119 | `frontend/src/services/keyboardShortcuts.ts` | `file` | Source file: keyboardShortcuts.ts | `frontend` |
| 120 | `frontend/src/services/stagedQueueService.ts` | `file` | Source file: stagedQueueService.ts | `frontend` |
| 121 | `frontend/src/types/api.ts` | `file` | Source file: api.ts | `frontend` |
| 122 | `frontend/src/types/window.d.ts` | `file` | Source file: window.d.ts | `frontend` |
| 123 | `frontend/src/utils/cacheInvalidation.ts` | `file` | Source file: cacheInvalidation.ts | `frontend` |
| 124 | `frontend/src/utils/currency.ts` | `file` | Source file: currency.ts | `frontend` |
| 125 | `frontend/src/utils/date.ts` | `file` | Source file: date.ts | `frontend` |
| 126 | `frontend/src/utils/distributorValidator.ts` | `file` | Source file: distributorValidator.ts | `frontend` |
| 127 | `frontend/src/utils/export.ts` | `file` | Source file: export.ts | `frontend` |
| 128 | `frontend/src/utils/fuzzy.ts` | `file` | Source file: fuzzy.ts | `frontend` |
| 129 | `frontend/src/utils/imageOptimizer.ts` | `file` | Source file: imageOptimizer.ts | `frontend` |
| 130 | `frontend/src/utils/onlineOrders.ts` | `file` | Source file: onlineOrders.ts | `frontend` |
| 131 | `frontend/src/utils/orderFuzzyMatcher.ts` | `file` | Source file: orderFuzzyMatcher.ts | `frontend` |
| 132 | `frontend/src/utils/packagingMatcher.ts` | `file` | Source file: packagingMatcher.ts | `frontend` |
| 133 | `frontend/src/utils/pageModuleCaches.ts` | `file` | Source file: pageModuleCaches.ts | `frontend` |
| 134 | `frontend/src/utils/phone.ts` | `file` | Source file: phone.ts | `frontend` |
| 135 | `frontend/src/utils/printBill.ts` | `file` | Source file: printBill.ts | `frontend` |
| 136 | `frontend/src/utils/searchRanker.ts` | `file` | Source file: searchRanker.ts | `frontend` |
| 137 | `frontend/src/utils/settingsSync.ts` | `file` | Source file: settingsSync.ts | `frontend` |
| 138 | `frontend/src/utils/whatsappFailureReason.ts` | `file` | Source file: whatsappFailureReason.ts | `whatsapp` `frontend` |
| 139 | `frontend/tailwind.config.js` | `file` | Source file: tailwind.config.js | `frontend` |
| 140 | `frontend/tsconfig.app.json` | `config` | Configuration: tsconfig.app.json | `config` `frontend` |
| 141 | `frontend/tsconfig.json` | `config` | Configuration: tsconfig.json | `config` `frontend` |
| 142 | `frontend/tsconfig.node.json` | `config` | Configuration: tsconfig.node.json | `config` `frontend` |
| 143 | `frontend/vercel.json` | `config` | Configuration: vercel.json | `config` `frontend` |
| 144 | `frontend/vite.config.ts` | `file` | Source file: vite.config.ts | `frontend` |

### Mobile Layer — `layer:mobile`

<small style="color:#f59e0b">66 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `pharmacy-mobile/.claude/settings.json` | `config` | Configuration: settings.json | `config` `mobile` |
| 2 | `pharmacy-mobile/.vscode/extensions.json` | `config` | Configuration: extensions.json | `config` `mobile` |
| 3 | `pharmacy-mobile/.vscode/settings.json` | `config` | Configuration: settings.json | `config` `mobile` |
| 4 | `pharmacy-mobile/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` `mobile` |
| 5 | `pharmacy-mobile/android-configs/README.md` | `document` | Documentation: README.md | `documentation` `mobile` |
| 6 | `pharmacy-mobile/app.json` | `config` | Configuration: app.json | `config` `mobile` |
| 7 | `pharmacy-mobile/app/_layout.tsx` | `file` | Source file: _layout.tsx | `mobile` |
| 8 | `pharmacy-mobile/app/(tabs)/_layout.tsx` | `file` | Source file: _layout.tsx | `mobile` |
| 9 | `pharmacy-mobile/app/(tabs)/billing/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 10 | `pharmacy-mobile/app/(tabs)/inbox/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 11 | `pharmacy-mobile/app/(tabs)/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 12 | `pharmacy-mobile/app/(tabs)/inventory/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 13 | `pharmacy-mobile/app/(tabs)/more/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 14 | `pharmacy-mobile/app/(tabs)/purchases/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 15 | `pharmacy-mobile/app/(tabs)/refills/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 16 | `pharmacy-mobile/app/+not-found.tsx` | `file` | Source file: +not-found.tsx | `mobile` |
| 17 | `pharmacy-mobile/app/camera/index.tsx` | `file` | Source file: index.tsx | `ocr` `mobile` |
| 18 | `pharmacy-mobile/app/devices/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 19 | `pharmacy-mobile/app/notifications/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 20 | `pharmacy-mobile/app/product-search/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 21 | `pharmacy-mobile/app/scan/index.tsx` | `file` | Source file: index.tsx | `mobile` |
| 22 | `pharmacy-mobile/assets/data/README.md` | `document` | Documentation: README.md | `documentation` `mobile` |
| 23 | `pharmacy-mobile/components/AppLock.tsx` | `file` | Source file: AppLock.tsx | `mobile` |
| 24 | `pharmacy-mobile/components/Card.tsx` | `file` | Source file: Card.tsx | `mobile` |
| 25 | `pharmacy-mobile/components/CartItem.tsx` | `file` | Source file: CartItem.tsx | `mobile` |
| 26 | `pharmacy-mobile/components/DeviceStatusHeader.tsx` | `file` | Source file: DeviceStatusHeader.tsx | `mobile` |
| 27 | `pharmacy-mobile/components/DrawerMenu.tsx` | `file` | Source file: DrawerMenu.tsx | `mobile` |
| 28 | `pharmacy-mobile/components/EditScreenInfo.tsx` | `file` | Source file: EditScreenInfo.tsx | `mobile` |
| 29 | `pharmacy-mobile/components/ExternalLink.tsx` | `file` | Source file: ExternalLink.tsx | `mobile` |
| 30 | `pharmacy-mobile/components/MedicineRow.tsx` | `file` | Source file: MedicineRow.tsx | `mobile` |
| 31 | `pharmacy-mobile/components/ProductListPanel.tsx` | `file` | Source file: ProductListPanel.tsx | `mobile` |
| 32 | `pharmacy-mobile/components/SearchBar.tsx` | `file` | Source file: SearchBar.tsx | `mobile` |
| 33 | `pharmacy-mobile/components/ServerSetup.tsx` | `file` | Source file: ServerSetup.tsx | `mobile` |
| 34 | `pharmacy-mobile/components/StatCard.tsx` | `file` | Source file: StatCard.tsx | `mobile` |
| 35 | `pharmacy-mobile/components/StyledText.tsx` | `file` | Source file: StyledText.tsx | `mobile` |
| 36 | `pharmacy-mobile/components/SwipeToDelete.tsx` | `file` | Source file: SwipeToDelete.tsx | `mobile` |
| 37 | `pharmacy-mobile/components/Themed.tsx` | `file` | Source file: Themed.tsx | `mobile` |
| 38 | `pharmacy-mobile/components/UpwardSearchDropdown.tsx` | `file` | Source file: UpwardSearchDropdown.tsx | `mobile` |
| 39 | `pharmacy-mobile/components/useClientOnlyValue.ts` | `file` | Source file: useClientOnlyValue.ts | `mobile` |
| 40 | `pharmacy-mobile/components/useClientOnlyValue.web.ts` | `file` | Source file: useClientOnlyValue.web.ts | `mobile` |
| 41 | `pharmacy-mobile/components/useColorScheme.ts` | `file` | Source file: useColorScheme.ts | `mobile` |
| 42 | `pharmacy-mobile/components/useColorScheme.web.ts` | `file` | Source file: useColorScheme.web.ts | `mobile` |
| 43 | `pharmacy-mobile/constants/Colors.ts` | `file` | Source file: Colors.ts | `mobile` |
| 44 | `pharmacy-mobile/expo-env.d.ts` | `file` | Source file: expo-env.d.ts | `mobile` |
| 45 | `pharmacy-mobile/lib/api.ts` | `file` | Source file: api.ts | `mobile` |
| 46 | `pharmacy-mobile/lib/api/admin.ts` | `file` | Source file: admin.ts | `mobile` |
| 47 | `pharmacy-mobile/lib/api/client.ts` | `file` | Source file: client.ts | `mobile` |
| 48 | `pharmacy-mobile/lib/api/gmail.ts` | `file` | Source file: gmail.ts | `mobile` |
| 49 | `pharmacy-mobile/lib/api/inventory.ts` | `file` | Source file: inventory.ts | `mobile` |
| 50 | `pharmacy-mobile/lib/api/misc.ts` | `file` | Source file: misc.ts | `mobile` |
| 51 | `pharmacy-mobile/lib/api/notifications.ts` | `file` | Source file: notifications.ts | `mobile` |
| 52 | `pharmacy-mobile/lib/api/orders.ts` | `file` | Source file: orders.ts | `mobile` |
| 53 | `pharmacy-mobile/lib/api/purchases.ts` | `file` | Source file: purchases.ts | `mobile` |
| 54 | `pharmacy-mobile/lib/api/refills.ts` | `file` | Source file: refills.ts | `mobile` |
| 55 | `pharmacy-mobile/lib/api/sales.ts` | `file` | Source file: sales.ts | `mobile` |
| 56 | `pharmacy-mobile/lib/api/scan.ts` | `file` | Source file: scan.ts | `mobile` |
| 57 | `pharmacy-mobile/lib/api/scanBill.ts` | `file` | Source file: scanBill.ts | `mobile` |
| 58 | `pharmacy-mobile/lib/api/sync.ts` | `file` | Source file: sync.ts | `mobile` |
| 59 | `pharmacy-mobile/lib/cartEvents.ts` | `file` | Source file: cartEvents.ts | `mobile` |
| 60 | `pharmacy-mobile/lib/helpers.ts` | `file` | Source file: helpers.ts | `mobile` |
| 61 | `pharmacy-mobile/lib/secureStore.ts` | `file` | Source file: secureStore.ts | `mobile` |
| 62 | `pharmacy-mobile/lib/stock.ts` | `file` | Source file: stock.ts | `mobile` |
| 63 | `pharmacy-mobile/lib/theme.ts` | `file` | Source file: theme.ts | `mobile` |
| 64 | `pharmacy-mobile/package.json` | `config` | Configuration: package.json | `config` `mobile` |
| 65 | `pharmacy-mobile/PLAN.md` | `document` | Documentation: PLAN.md | `documentation` `mobile` |
| 66 | `pharmacy-mobile/tsconfig.json` | `config` | Configuration: tsconfig.json | `config` `mobile` |

### API Layer — `layer:api`

<small style="color:#a855f7">58 node(s) in graph</small>

#### Routes

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/routes/aiCamera.ts` | `file` | API route handler | `api` |
| 2 | `src/routes/api/adminRoutes.ts` | `file` | API route handler | `api` |
| 3 | `src/routes/api/customerRoutes.ts` | `file` | API route handler | `api` |
| 4 | `src/routes/audit.ts` | `file` | API route handler | `api` |
| 5 | `src/routes/auth.ts` | `file` | API route handler | `auth` `api` |
| 6 | `src/routes/automation.ts` | `file` | API route handler | `api` |
| 7 | `src/routes/catalog.ts` | `file` | API route handler | `api` |
| 8 | `src/routes/catalogImages.ts` | `file` | API route handler | `api` |
| 9 | `src/routes/clinical.ts` | `file` | API route handler | `api` |
| 10 | `src/routes/compliance.ts` | `file` | API route handler | `api` |
| 11 | `src/routes/contacts.ts` | `file` | API route handler | `api` |
| 12 | `src/routes/crm.ts` | `file` | API route handler | `api` |
| 13 | `src/routes/customerPortal.ts` | `file` | API route handler | `api` |
| 14 | `src/routes/customerReturns.ts` | `file` | API route handler | `api` |
| 15 | `src/routes/dashboard.ts` | `file` | API route handler | `api` |
| 16 | `src/routes/dispatch.ts` | `file` | API route handler | `api` |
| 17 | `src/routes/distributors.ts` | `file` | API route handler | `api` |
| 18 | `src/routes/email.ts` | `file` | API route handler | `email` `api` |
| 19 | `src/routes/emailOrderReviews.ts` | `file` | API route handler | `email` `api` |
| 20 | `src/routes/enquiries.ts` | `file` | API route handler | `api` |
| 21 | `src/routes/enrichment.ts` | `file` | API route handler | `api` |
| 22 | `src/routes/expiry.ts` | `file` | API route handler | `api` |
| 23 | `src/routes/inventory.ts` | `file` | API route handler | `api` |
| 24 | `src/routes/investigation.ts` | `file` | API route handler | `api` |
| 25 | `src/routes/learning.ts` | `file` | API route handler | `api` |
| 26 | `src/routes/license.ts` | `file` | API route handler | `auth` `api` |
| 27 | `src/routes/medicineAvailability.ts` | `file` | API route handler | `api` |
| 28 | `src/routes/medicines.ts` | `file` | API route handler | `api` |
| 29 | `src/routes/messaging.ts` | `file` | API route handler | `api` |
| 30 | `src/routes/migration.ts` | `file` | API route handler | `migration` `api` |
| 31 | `src/routes/notifications.ts` | `file` | API route handler | `api` |
| 32 | `src/routes/orders.ts` | `file` | API route handler | `api` |
| 33 | `src/routes/pharmarack.ts` | `file` | API route handler | `api` |
| 34 | `src/routes/prescriptions.ts` | `file` | API route handler | `api` |
| 35 | `src/routes/purchases.ts` | `file` | API route handler | `api` |
| 36 | `src/routes/quickAssistant.ts` | `file` | API route handler | `api` |
| 37 | `src/routes/refills.ts` | `file` | API route handler | `api` |
| 38 | `src/routes/reports.ts` | `file` | API route handler | `api` |
| 39 | `src/routes/returns.ts` | `file` | API route handler | `api` |
| 40 | `src/routes/sales.ts` | `file` | API route handler | `api` |
| 41 | `src/routes/scan.ts` | `file` | API route handler | `api` |
| 42 | `src/routes/scheduleDrugs.ts` | `file` | API route handler | `api` |
| 43 | `src/routes/security.ts` | `file` | API route handler | `api` |
| 44 | `src/routes/sellPrice.ts` | `file` | API route handler | `api` |
| 45 | `src/routes/serviceStatus.ts` | `file` | API route handler | `api` |
| 46 | `src/routes/settings.ts` | `file` | API route handler | `api` |
| 47 | `src/routes/stores.ts` | `file` | API route handler | `api` |
| 48 | `src/routes/sync.ts` | `file` | API route handler | `api` |
| 49 | `src/routes/telegramPrescription.ts` | `file` | API route handler | `telegram` `api` |
| 50 | `src/routes/triggers.ts` | `file` | API route handler | `api` |
| 51 | `src/routes/tunnel.ts` | `file` | API route handler | `api` |
| 52 | `src/routes/upload.ts` | `file` | API route handler | `api` |
| 53 | `src/routes/utilities.ts` | `file` | API route handler | `api` |
| 54 | `src/routes/verification.ts` | `file` | API route handler | `api` |
| 55 | `src/routes/websiteOrders.ts` | `file` | API route handler | `api` |
| 56 | `src/routes/websiteOwner.ts` | `file` | API route handler | `api` |
| 57 | `src/routes/whatsappBusiness.ts` | `file` | API route handler | `whatsapp` `api` |
| 58 | `src/routes/whatsappQueue.ts` | `file` | API route handler | `whatsapp` `api` |

### Service Layer — `layer:service`

<small style="color:#10b981">92 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/services/activityLogger.ts` | `service` | Business service | `service` `business-logic` |
| 2 | `src/services/activityTracker.ts` | `service` | Business service | `service` `business-logic` |
| 3 | `src/services/aiCameraService.ts` | `service` | Business service | `service` `business-logic` |
| 4 | `src/services/apiClients/baseApiClient.ts` | `service` | Business service | `service` `business-logic` |
| 5 | `src/services/apiClients/openFdaClient.ts` | `service` | Business service | `service` `business-logic` |
| 6 | `src/services/apiClients/rxNormClient.ts` | `service` | Business service | `service` `business-logic` |
| 7 | `src/services/auditLoggerService.ts` | `service` | Business service | `service` `business-logic` |
| 8 | `src/services/auth/customerAuthService.ts` | `service` | Business service | `service` `auth` `business-logic` |
| 9 | `src/services/automationCatalog.ts` | `service` | Business service | `service` `business-logic` |
| 10 | `src/services/autoUpdateService.ts` | `service` | Business service | `service` `business-logic` |
| 11 | `src/services/backupRecoveryService.ts` | `service` | Business service | `service` `business-logic` |
| 12 | `src/services/backupService.ts` | `service` | Business service | `service` `business-logic` |
| 13 | `src/services/barcodeService.ts` | `service` | Business service | `service` `business-logic` |
| 14 | `src/services/bouncedAlertService.ts` | `service` | Business service | `service` `business-logic` |
| 15 | `src/services/cacheService.ts` | `service` | Business service | `service` `business-logic` |
| 16 | `src/services/catalog/catalogService.ts` | `service` | Business service | `service` `business-logic` |
| 17 | `src/services/catalogImageService.ts` | `service` | Business service | `service` `business-logic` |
| 18 | `src/services/cloudCatalogSyncService.ts` | `service` | Business service | `service` `business-logic` |
| 19 | `src/services/cloudflareTunnelService.ts` | `service` | Business service | `service` `business-logic` |
| 20 | `src/services/creditNoteService.ts` | `service` | Business service | `service` `business-logic` |
| 21 | `src/services/creditReminderService.ts` | `service` | Business service | `service` `business-logic` |
| 22 | `src/services/customer/customerService.ts` | `service` | Business service | `service` `business-logic` |
| 23 | `src/services/dataFetchControl.ts` | `service` | Business service | `service` `business-logic` |
| 24 | `src/services/dataMerger.ts` | `service` | Business service | `service` `business-logic` |
| 25 | `src/services/distributorDispatchReminderWorker.ts` | `service` | Business service | `service` `business-logic` |
| 26 | `src/services/distributorRecommendationService.ts` | `service` | Business service | `service` `business-logic` |
| 27 | `src/services/doctorReportingService.ts` | `service` | Business service | `service` `business-logic` |
| 28 | `src/services/dosageGroupService.ts` | `service` | Business service | `service` `business-logic` |
| 29 | `src/services/emailService.ts` | `service` | Business service | `service` `email` `business-logic` |
| 30 | `src/services/eventService.ts` | `service` | Business service | `service` `business-logic` |
| 31 | `src/services/expiryAlertService.ts` | `service` | Business service | `service` `business-logic` |
| 32 | `src/services/googleSearchService.ts` | `service` | Business service | `service` `business-logic` |
| 33 | `src/services/imageArchiveService.ts` | `service` | Business service | `service` `business-logic` |
| 34 | `src/services/imageCompressionService.ts` | `service` | Business service | `service` `business-logic` |
| 35 | `src/services/intentKeywords.ts` | `service` | Business service | `service` `business-logic` |
| 36 | `src/services/inventoryCache.ts` | `service` | Business service | `service` `business-logic` |
| 37 | `src/services/inventoryService.ts` | `service` | Business service | `service` `business-logic` |
| 38 | `src/services/invoiceService.ts` | `service` | Business service | `service` `invoice` `business-logic` |
| 39 | `src/services/invoiceVisionService.ts` | `service` | Business service | `service` `invoice` `business-logic` |
| 40 | `src/services/licenseService.ts` | `service` | Business service | `service` `auth` `business-logic` |
| 41 | `src/services/masterMedicinesSeedService.ts` | `service` | Business service | `service` `business-logic` |
| 42 | `src/services/medicineAvailabilityEngine.ts` | `service` | Business service | `service` `business-logic` |
| 43 | `src/services/medicineSalesMetricsService.ts` | `service` | Business service | `service` `business-logic` |
| 44 | `src/services/medicineService.ts` | `service` | Business service | `service` `business-logic` |
| 45 | `src/services/messageClassifier.ts` | `service` | Business service | `service` `business-logic` |
| 46 | `src/services/messagingQueue.ts` | `service` | Business service | `service` `business-logic` |
| 47 | `src/services/monthlyReportService.ts` | `service` | Business service | `service` `business-logic` |
| 48 | `src/services/nonMovingReportService.ts` | `service` | Business service | `service` `business-logic` |
| 49 | `src/services/notificationService.ts` | `service` | Business service | `service` `business-logic` |
| 50 | `src/services/ocrScanQueue.ts` | `service` | Business service | `service` `ocr` `business-logic` |
| 51 | `src/services/onlineDataEnricher.ts` | `service` | Business service | `service` `business-logic` |
| 52 | `src/services/onnxOcrService.ts` | `service` | Business service | `service` `business-logic` |
| 53 | `src/services/orderFulfillmentService.ts` | `service` | Business service | `service` `business-logic` |
| 54 | `src/services/orderScheduleService.ts` | `service` | Business service | `service` `business-logic` |
| 55 | `src/services/orderTrackingService.ts` | `service` | Business service | `service` `business-logic` |
| 56 | `src/services/overlapDetectionService.ts` | `service` | Business service | `service` `business-logic` |
| 57 | `src/services/paymentQrService.ts` | `service` | Business service | `service` `business-logic` |
| 58 | `src/services/pdfInvoiceService.ts` | `service` | Business service | `service` `business-logic` |
| 59 | `src/services/pharmarackCatalogCache.ts` | `service` | Business service | `service` `business-logic` |
| 60 | `src/services/pharmarackDailyDispatchService.ts` | `service` | Business service | `service` `business-logic` |
| 61 | `src/services/prescriptionIntelService.ts` | `service` | Business service | `service` `business-logic` |
| 62 | `src/services/prescriptionOrchestratorService.ts` | `service` | Business service | `service` `business-logic` |
| 63 | `src/services/prescriptionScannerService.ts` | `service` | Business service | `service` `business-logic` |
| 64 | `src/services/pricing/pricingService.ts` | `service` | Business service | `service` `business-logic` |
| 65 | `src/services/productNameFilterService.ts` | `service` | Business service | `service` `business-logic` |
| 66 | `src/services/pushNotificationService.ts` | `service` | Business service | `service` `business-logic` |
| 67 | `src/services/refillOrderReconciler.ts` | `service` | Business service | `service` `business-logic` |
| 68 | `src/services/refillService.ts` | `service` | Business service | `service` `business-logic` |
| 69 | `src/services/returnsService.ts` | `service` | Business service | `service` `business-logic` |
| 70 | `src/services/returnWindowService.ts` | `service` | Business service | `service` `business-logic` |
| 71 | `src/services/scheduleResearchService.ts` | `service` | Business service | `service` `business-logic` |
| 72 | `src/services/scispacyClient.ts` | `service` | Business service | `service` `business-logic` |
| 73 | `src/services/searchCache.ts` | `service` | Business service | `service` `business-logic` |
| 74 | `src/services/shortageReminderService.ts` | `service` | Business service | `service` `business-logic` |
| 75 | `src/services/similarityService.ts` | `service` | Business service | `service` `business-logic` |
| 76 | `src/services/startupSyncCoordinator.ts` | `service` | Business service | `service` `business-logic` |
| 77 | `src/services/storeContextService.ts` | `service` | Business service | `service` `business-logic` |
| 78 | `src/services/storeSettingsService.ts` | `service` | Business service | `service` `business-logic` |
| 79 | `src/services/storeSyncService.ts` | `service` | Business service | `service` `business-logic` |
| 80 | `src/services/summaryCacheService.ts` | `service` | Business service | `service` `business-logic` |
| 81 | `src/services/telegramPrescriptionService.ts` | `service` | Business service | `service` `telegram` `business-logic` |
| 82 | `src/services/tokenRefreshScheduler.ts` | `service` | Business service | `service` `business-logic` |
| 83 | `src/services/triggerSchedulerService.ts` | `service` | Business service | `service` `business-logic` |
| 84 | `src/services/verificationService.ts` | `service` | Business service | `service` `business-logic` |
| 85 | `src/services/visualIndexService.ts` | `service` | Business service | `service` `business-logic` |
| 86 | `src/services/waAdminEscalationService.ts` | `service` | Business service | `service` `business-logic` |
| 87 | `src/services/whatsappBusinessService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 88 | `src/services/whatsappDeliveryRegister.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 89 | `src/services/whatsappIntentService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 90 | `src/services/whatsappInvoiceService.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 91 | `src/services/whatsappQueue.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |
| 92 | `src/services/whatsappQueueWorker.ts` | `service` | Business service | `service` `whatsapp` `business-logic` |

### Infrastructure Layer — `layer:infrastructure`

<small style="color:#06b6d4">26 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `src/middleware/apiResponse.ts` | `file` | Express middleware | `general` |
| 2 | `src/middleware/asyncHandler.ts` | `file` | Express middleware | `general` |
| 3 | `src/middleware/errorHandler.ts` | `file` | Express middleware | `general` |
| 4 | `src/middleware/notFoundHandler.ts` | `file` | Express middleware | `general` |
| 5 | `src/middleware/tenantAuth.ts` | `file` | Express middleware | `general` |
| 6 | `src/worker/autoMatchWorker.ts` | `file` | Background worker | `general` |
| 7 | `src/worker/catalogWorker.ts` | `file` | Background worker | `general` |
| 8 | `src/worker/compositionEnricher.ts` | `file` | Background worker | `general` |
| 9 | `src/worker/emailPoller.ts` | `file` | Background worker | `email` |
| 10 | `src/worker/importers/pgB2BImporter.ts` | `file` | Background worker | `general` |
| 11 | `src/worker/importers/pgExtrasImporter.ts` | `file` | Background worker | `general` |
| 12 | `src/worker/importers/pgMasterImporter.ts` | `file` | Background worker | `general` |
| 13 | `src/worker/importers/pgPaymentsImporter.ts` | `file` | Background worker | `general` |
| 14 | `src/worker/importers/pgPurchaseImporter.ts` | `file` | Background worker | `general` |
| 15 | `src/worker/importers/pgReturnsImporter.ts` | `file` | Background worker | `general` |
| 16 | `src/worker/importers/pgSalesImporter.ts` | `file` | Background worker | `general` |
| 17 | `src/worker/migrationWorker.ts` | `file` | Background worker | `migration` |
| 18 | `src/worker/parsers/inventoryParser.ts` | `file` | Background worker | `general` |
| 19 | `src/worker/parsers/pgCopyParser.ts` | `file` | Background worker | `general` |
| 20 | `src/worker/parsers/returnsParser.ts` | `file` | Background worker | `general` |
| 21 | `src/worker/parsers/salesParser.ts` | `file` | Background worker | `general` |
| 22 | `src/worker/runCatalogWorker.ts` | `file` | Background worker | `general` |
| 23 | `src/worker/runEmailPoller.ts` | `file` | Background worker | `general` |
| 24 | `src/worker/stockCalculatorWorker.ts` | `file` | Background worker | `general` |
| 25 | `src/worker/substituteCacheWorker.ts` | `file` | Background worker | `general` |
| 26 | `src/worker/workerSupervisor.ts` | `file` | Background worker | `general` |

### Data Layer — `layer:data`

<small style="color:#3b82f6">69 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `data/app_browser_profile/ActorSafetyLists/9.5220.3721/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 2 | `data/app_browser_profile/ActorSafetyLists/9.5220.3721/listdata.json` | `file` | Configuration: listdata.json | `general` |
| 3 | `data/app_browser_profile/ActorSafetyLists/9.5220.3721/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 4 | `data/app_browser_profile/AmountExtractionHeuristicRegexes/4/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 5 | `data/app_browser_profile/AmountExtractionHeuristicRegexes/4/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 6 | `data/app_browser_profile/CaptchaProviders/8.5419.4434/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 7 | `data/app_browser_profile/CaptchaProviders/8.5419.4434/captcha_providers.json` | `file` | Configuration: captcha_providers.json | `general` |
| 8 | `data/app_browser_profile/CaptchaProviders/8.5419.4434/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 9 | `data/app_browser_profile/CertificateRevocation/10768/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 10 | `data/app_browser_profile/CertificateRevocation/10768/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 11 | `data/app_browser_profile/component_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 12 | `data/app_browser_profile/Crowd Deny/2026.9.10.80/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 13 | `data/app_browser_profile/Crowd Deny/2026.9.10.80/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 14 | `data/app_browser_profile/extensions_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 15 | `data/app_browser_profile/FileTypePolicies/145.0.7584.0/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 16 | `data/app_browser_profile/FileTypePolicies/145.0.7584.0/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 17 | `data/app_browser_profile/FirstPartySetsPreloaded/2025.7.24.0/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 18 | `data/app_browser_profile/FirstPartySetsPreloaded/2025.7.24.0/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 19 | `data/app_browser_profile/FirstPartySetsPreloaded/2025.7.24.0/sets.json` | `file` | Configuration: sets.json | `general` |
| 20 | `data/app_browser_profile/hyphen-data/120.0.6050.0/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 21 | `data/app_browser_profile/hyphen-data/120.0.6050.0/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 22 | `data/app_browser_profile/MEIPreload/1.1.0.3/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 23 | `data/app_browser_profile/MEIPreload/1.1.0.3/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 24 | `data/app_browser_profile/OnDeviceHeadSuggestModel/20251024.824731831.14/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 25 | `data/app_browser_profile/OnDeviceHeadSuggestModel/20251024.824731831.14/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 26 | `data/app_browser_profile/optimization_guide_model_store/24/E6DC4029A1E4B4C1/0BE3124F4D70381B/enus_denylist_encoded_241007.txt` | `file` | Source file: enus_denylist_encoded_241007.txt | `general` |
| 27 | `data/app_browser_profile/optimization_guide_model_store/24/E6DC4029A1E4B4C1/0BE3124F4D70381B/vocab_en-us.txt` | `file` | Source file: vocab_en-us.txt | `general` |
| 28 | `data/app_browser_profile/OptimizationGuideModelsManifest/1.20260913.2/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 29 | `data/app_browser_profile/OptimizationGuideModelsManifest/1.20260913.2/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 30 | `data/app_browser_profile/OptimizationHints/742/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 31 | `data/app_browser_profile/OptimizationHints/742/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 32 | `data/app_browser_profile/PKIMetadata/1773/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 33 | `data/app_browser_profile/PKIMetadata/1773/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 34 | `data/app_browser_profile/SafetyTips/3091/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 35 | `data/app_browser_profile/SafetyTips/3091/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 36 | `data/app_browser_profile/SSLErrorAssistant/7/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 37 | `data/app_browser_profile/SSLErrorAssistant/7/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 38 | `data/app_browser_profile/Subresource Filter/Unindexed Rules/9.71.0/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 39 | `data/app_browser_profile/Subresource Filter/Unindexed Rules/9.71.0/LICENSE.txt` | `file` | Source file: LICENSE.txt | `general` |
| 40 | `data/app_browser_profile/Subresource Filter/Unindexed Rules/9.71.0/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 41 | `data/app_browser_profile/TrustTokenKeyCommitments/2026.8.3.1/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 42 | `data/app_browser_profile/TrustTokenKeyCommitments/2026.8.3.1/keys.json` | `file` | Configuration: keys.json | `general` |
| 43 | `data/app_browser_profile/TrustTokenKeyCommitments/2026.8.3.1/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 44 | `data/app_browser_profile/WasmTtsEngine/20260826.1/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 45 | `data/app_browser_profile/WasmTtsEngine/20260826.1/background_compiled.js` | `file` | Source file: background_compiled.js | `general` |
| 46 | `data/app_browser_profile/WasmTtsEngine/20260826.1/bindings_main.js` | `file` | Source file: bindings_main.js | `general` |
| 47 | `data/app_browser_profile/WasmTtsEngine/20260826.1/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 48 | `data/app_browser_profile/WasmTtsEngine/20260826.1/offscreen_compiled.js` | `file` | Source file: offscreen_compiled.js | `general` |
| 49 | `data/app_browser_profile/WasmTtsEngine/20260826.1/offscreen.html` | `file` | Source file: offscreen.html | `general` |
| 50 | `data/app_browser_profile/WasmTtsEngine/20260826.1/streaming_worklet_processor.js` | `file` | Source file: streaming_worklet_processor.js | `general` |
| 51 | `data/app_browser_profile/WasmTtsEngine/20260826.1/voices.json` | `file` | Configuration: voices.json | `general` |
| 52 | `data/app_browser_profile/WasmTtsEngine/20260826.1/wasm_tts_manifest_v3.json` | `file` | Configuration: wasm_tts_manifest_v3.json | `general` |
| 53 | `data/app_browser_profile/ZxcvbnData/3/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 54 | `data/app_browser_profile/ZxcvbnData/3/english_wikipedia.txt` | `file` | Source file: english_wikipedia.txt | `general` |
| 55 | `data/app_browser_profile/ZxcvbnData/3/female_names.txt` | `file` | Source file: female_names.txt | `general` |
| 56 | `data/app_browser_profile/ZxcvbnData/3/male_names.txt` | `file` | Source file: male_names.txt | `general` |
| 57 | `data/app_browser_profile/ZxcvbnData/3/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 58 | `data/app_browser_profile/ZxcvbnData/3/passwords.txt` | `file` | Source file: passwords.txt | `general` |
| 59 | `data/app_browser_profile/ZxcvbnData/3/surnames.txt` | `file` | Source file: surnames.txt | `general` |
| 60 | `data/app_browser_profile/ZxcvbnData/3/us_tv_and_film.txt` | `file` | Source file: us_tv_and_film.txt | `general` |
| 61 | `data/audit_queue.json` | `file` | Configuration: audit_queue.json | `general` |
| 62 | `data/models/en_dict.txt` | `file` | Source file: en_dict.txt | `general` |
| 63 | `data/pharmarack_profile/component_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 64 | `data/pharmarack_profile/extensions_crx_cache/metadata.json` | `file` | Configuration: metadata.json | `general` |
| 65 | `data/pharmarack_profile/optimization_guide_model_store/24/E6DC4029A1E4B4C1/499F7B5ED4AAEC0B/enus_denylist_encoded_241007.txt` | `file` | Source file: enus_denylist_encoded_241007.txt | `general` |
| 66 | `data/pharmarack_profile/optimization_guide_model_store/24/E6DC4029A1E4B4C1/499F7B5ED4AAEC0B/vocab_en-us.txt` | `file` | Source file: vocab_en-us.txt | `general` |
| 67 | `data/pharmarack_profile/OptimizationGuideModelsManifest/1.20260913.2/_metadata/verified_contents.json` | `file` | Configuration: verified_contents.json | `general` |
| 68 | `data/pharmarack_profile/OptimizationGuideModelsManifest/1.20260913.2/manifest.json` | `file` | Configuration: manifest.json | `general` |
| 69 | `data/search-cache.json` | `file` | Configuration: search-cache.json | `general` |

### Testing Layer — `layer:testing`

<small style="color:#ef4444">115 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `tests/aiCamera.test.ts` | `test` | Test: aiCamera.test.ts | `test` |
| 2 | `tests/auditIntegrity.test.ts` | `test` | Test: auditIntegrity.test.ts | `test` |
| 3 | `tests/automation.test.ts` | `test` | Test: automation.test.ts | `test` |
| 4 | `tests/automationCatalog.test.ts` | `test` | Test: automationCatalog.test.ts | `test` |
| 5 | `tests/automationHubPacing.test.ts` | `test` | Test: automationHubPacing.test.ts | `test` |
| 6 | `tests/automationHubSummary.test.ts` | `test` | Test: automationHubSummary.test.ts | `test` |
| 7 | `tests/backgroundJobLane.test.ts` | `test` | Test: backgroundJobLane.test.ts | `test` |
| 8 | `tests/backupRecovery.test.ts` | `test` | Test: backupRecovery.test.ts | `test` |
| 9 | `tests/catalogImageAuditor.test.ts` | `test` | Test: catalogImageAuditor.test.ts | `test` |
| 10 | `tests/catalogImageVerification.test.ts` | `test` | Test: catalogImageVerification.test.ts | `test` |
| 11 | `tests/catalogPipeline.test.ts` | `test` | Test: catalogPipeline.test.ts | `test` |
| 12 | `tests/catalogService.test.ts` | `test` | Test: catalogService.test.ts | `test` |
| 13 | `tests/centralLocalSync.test.ts` | `test` | Test: centralLocalSync.test.ts | `test` |
| 14 | `tests/complianceDataIntegrity.test.ts` | `test` | Test: complianceDataIntegrity.test.ts | `test` |
| 15 | `tests/crm.test.ts` | `test` | Test: crm.test.ts | `test` |
| 16 | `tests/crossDistributorReturns.test.ts` | `test` | Test: crossDistributorReturns.test.ts | `test` |
| 17 | `tests/customerAuthService.test.ts` | `test` | Test: customerAuthService.test.ts | `test` |
| 18 | `tests/customerPortalLifecycle.test.ts` | `test` | Test: customerPortalLifecycle.test.ts | `test` |
| 19 | `tests/dbIntegrity.test.ts` | `test` | Test: dbIntegrity.test.ts | `test` |
| 20 | `tests/distributorLearning.test.ts` | `test` | Test: distributorLearning.test.ts | `test` |
| 21 | `tests/distributorNotification.test.ts` | `test` | Test: distributorNotification.test.ts | `test` |
| 22 | `tests/distributorSanitization.test.ts` | `test` | Test: distributorSanitization.test.ts | `test` |
| 23 | `tests/distributorSyncPersistence.test.ts` | `test` | Test: distributorSyncPersistence.test.ts | `test` |
| 24 | `tests/doctorSanitization.test.ts` | `test` | Test: doctorSanitization.test.ts | `test` |
| 25 | `tests/duplicateCatalog.test.ts` | `test` | Test: duplicateCatalog.test.ts | `test` |
| 26 | `tests/email_attachments.test.ts` | `test` | Test: email_attachments.test.ts | `test` `email` |
| 27 | `tests/email_notifications.test.ts` | `test` | Test: email_notifications.test.ts | `test` `email` |
| 28 | `tests/email_retention.test.ts` | `test` | Test: email_retention.test.ts | `test` `email` |
| 29 | `tests/emailDistributorIntegrity.test.ts` | `test` | Test: emailDistributorIntegrity.test.ts | `test` `email` |
| 30 | `tests/emailPurchaseDateIntegrity.test.ts` | `test` | Test: emailPurchaseDateIntegrity.test.ts | `test` `email` |
| 31 | `tests/emailPurchaseDistributorIntegrity.test.ts` | `test` | Test: emailPurchaseDistributorIntegrity.test.ts | `test` `email` |
| 32 | `tests/expiryReturnReview.test.ts` | `test` | Test: expiryReturnReview.test.ts | `test` |
| 33 | `tests/ftsRepair.test.ts` | `test` | Test: ftsRepair.test.ts | `test` |
| 34 | `tests/intentKeywords.test.ts` | `test` | Test: intentKeywords.test.ts | `test` |
| 35 | `tests/inventoryActive.test.ts` | `test` | Test: inventoryActive.test.ts | `test` |
| 36 | `tests/inventoryAvailability.test.ts` | `test` | Test: inventoryAvailability.test.ts | `test` |
| 37 | `tests/inventoryFilters.test.ts` | `test` | Test: inventoryFilters.test.ts | `test` |
| 38 | `tests/inventoryParser.test.ts` | `test` | Test: inventoryParser.test.ts | `test` |
| 39 | `tests/investigation.test.ts` | `test` | Test: investigation.test.ts | `test` |
| 40 | `tests/investigationDelta.test.ts` | `test` | Test: investigationDelta.test.ts | `test` |
| 41 | `tests/invoiceNumberIntegrity.test.ts` | `test` | Test: invoiceNumberIntegrity.test.ts | `test` `invoice` |
| 42 | `tests/keyboardShortcuts.test.ts` | `test` | Test: keyboardShortcuts.test.ts | `test` |
| 43 | `tests/legitimateDataWorkflow.test.ts` | `test` | Test: legitimateDataWorkflow.test.ts | `test` |
| 44 | `tests/liveCartDropdownSorting.test.ts` | `test` | Test: liveCartDropdownSorting.test.ts | `test` |
| 45 | `tests/medicineSalesMetricsService.test.ts` | `test` | Test: medicineSalesMetricsService.test.ts | `test` |
| 46 | `tests/migrationDistributorHelpers.test.ts` | `test` | Test: migrationDistributorHelpers.test.ts | `test` `migration` |
| 47 | `tests/migrationLegacyMedicine.test.ts` | `test` | Test: migrationLegacyMedicine.test.ts | `test` `migration` |
| 48 | `tests/migrationPhantomIdAudit.test.ts` | `test` | Test: migrationPhantomIdAudit.test.ts | `test` `migration` |
| 49 | `tests/migrationPlaceholderIntegrity.test.ts` | `test` | Test: migrationPlaceholderIntegrity.test.ts | `test` `migration` |
| 50 | `tests/migrationRelationshipAudit.test.ts` | `test` | Test: migrationRelationshipAudit.test.ts | `test` `migration` |
| 51 | `tests/migrationStatusParser.test.ts` | `test` | Test: migrationStatusParser.test.ts | `test` `migration` |
| 52 | `tests/migrationStockRebuild.test.ts` | `test` | Test: migrationStockRebuild.test.ts | `test` `migration` |
| 53 | `tests/migrationV2.test.ts` | `test` | Test: migrationV2.test.ts | `test` `migration` |
| 54 | `tests/multiPharmacyComplete.test.ts` | `test` | Test: multiPharmacyComplete.test.ts | `test` |
| 55 | `tests/multiStoreFoundation.test.ts` | `test` | Test: multiStoreFoundation.test.ts | `test` |
| 56 | `tests/nearExpiryAuditReport.test.ts` | `test` | Test: nearExpiryAuditReport.test.ts | `test` |
| 57 | `tests/ocrParser.test.ts` | `test` | Test: ocrParser.test.ts | `test` `ocr` |
| 58 | `tests/onlineEnrichment.test.ts` | `test` | Test: onlineEnrichment.test.ts | `test` |
| 59 | `tests/orderScheduleService.test.ts` | `test` | Test: orderScheduleService.test.ts | `test` |
| 60 | `tests/ordersNotifiedFlag.test.ts` | `test` | Test: ordersNotifiedFlag.test.ts | `test` |
| 61 | `tests/packaging.test.ts` | `test` | Test: packaging.test.ts | `test` |
| 62 | `tests/paddleOcr.test.ts` | `test` | Test: paddleOcr.test.ts | `test` |
| 63 | `tests/pdf/pdfGenerator.missing.test.ts` | `test` | Test: pdfGenerator.missing.test.ts | `test` |
| 64 | `tests/pdf/pdfGenerator.test.ts` | `test` | Test: pdfGenerator.test.ts | `test` |
| 65 | `tests/pdfInvoiceDiscount.test.ts` | `test` | Test: pdfInvoiceDiscount.test.ts | `test` |
| 66 | `tests/pharmarackCartDelete.test.ts` | `test` | Test: pharmarackCartDelete.test.ts | `test` |
| 67 | `tests/pharmarackCartItemVisibility.test.ts` | `test` | Test: pharmarackCartItemVisibility.test.ts | `test` |
| 68 | `tests/pharmarackCartNotif.test.ts` | `test` | Test: pharmarackCartNotif.test.ts | `test` |
| 69 | `tests/pharmarackCatalogCache.test.ts` | `test` | Test: pharmarackCatalogCache.test.ts | `test` |
| 70 | `tests/preMigration.test.ts` | `test` | Test: preMigration.test.ts | `test` |
| 71 | `tests/pricingService.test.ts` | `test` | Test: pricingService.test.ts | `test` |
| 72 | `tests/processGuardian.test.ts` | `test` | Test: processGuardian.test.ts | `test` |
| 73 | `tests/productionMockDataProtection.test.ts` | `test` | Test: productionMockDataProtection.test.ts | `test` |
| 74 | `tests/purchaseDateIntegrity.test.ts` | `test` | Test: purchaseDateIntegrity.test.ts | `test` |
| 75 | `tests/purchaseDistributorIntegrity.test.ts` | `test` | Test: purchaseDistributorIntegrity.test.ts | `test` |
| 76 | `tests/purchaseMrpIntegrity.test.ts` | `test` | Test: purchaseMrpIntegrity.test.ts | `test` |
| 77 | `tests/real_integration_test.mjs` | `test` | Test: real_integration_test.mjs | `test` |
| 78 | `tests/refillPharmacyName.test.ts` | `test` | Test: refillPharmacyName.test.ts | `test` |
| 79 | `tests/refills.test.ts` | `test` | Test: refills.test.ts | `test` |
| 80 | `tests/restoreBackup.test.ts` | `test` | Test: restoreBackup.test.ts | `test` |
| 81 | `tests/returnLossIntegrity.test.ts` | `test` | Test: returnLossIntegrity.test.ts | `test` |
| 82 | `tests/returnsParser.test.ts` | `test` | Test: returnsParser.test.ts | `test` |
| 83 | `tests/returnWindow14Days.test.ts` | `test` | Test: returnWindow14Days.test.ts | `test` |
| 84 | `tests/salesParser.test.ts` | `test` | Test: salesParser.test.ts | `test` |
| 85 | `tests/salesValidation.test.ts` | `test` | Test: salesValidation.test.ts | `test` |
| 86 | `tests/sampleImages.test.ts` | `test` | Test: sampleImages.test.ts | `test` |
| 87 | `tests/scheduledDistributorRecovery.test.ts` | `test` | Test: scheduledDistributorRecovery.test.ts | `test` |
| 88 | `tests/searchRanker.test.ts` | `test` | Test: searchRanker.test.ts | `test` |
| 89 | `tests/services/productNameFilterService.test.ts` | `test` | Test: productNameFilterService.test.ts | `test` |
| 90 | `tests/specialOrderArrival.test.ts` | `test` | Test: specialOrderArrival.test.ts | `test` |
| 91 | `tests/stockRebuild.test.ts` | `test` | Test: stockRebuild.test.ts | `test` |
| 92 | `tests/telegramBot.test.ts` | `test` | Test: telegramBot.test.ts | `test` `telegram` |
| 93 | `tests/telegramPrescription.test.ts` | `test` | Test: telegramPrescription.test.ts | `test` `telegram` |
| 94 | `tests/tenantAndSnapshotIntegrity.test.ts` | `test` | Test: tenantAndSnapshotIntegrity.test.ts | `test` |
| 95 | `tests/tenantIsolationPhase1.test.ts` | `test` | Test: tenantIsolationPhase1.test.ts | `test` |
| 96 | `tests/uiPages.test.ts` | `test` | Test: uiPages.test.ts | `test` |
| 97 | `tests/utilities_smoke.test.ts` | `test` | Test: utilities_smoke.test.ts | `test` |
| 98 | `tests/utilities.test.ts` | `test` | Test: utilities.test.ts | `test` |
| 99 | `tests/utils/pdfGenerator.test.ts` | `test` | Test: pdfGenerator.test.ts | `test` |
| 100 | `tests/waAdminEscalation.test.ts` | `test` | Test: waAdminEscalation.test.ts | `test` |
| 101 | `tests/websiteOrderingQuickAssist.test.ts` | `test` | Test: websiteOrderingQuickAssist.test.ts | `test` |
| 102 | `tests/websiteOrderIntegration.test.ts` | `test` | Test: websiteOrderIntegration.test.ts | `test` |
| 103 | `tests/whatsapp/client.test.js` | `test` | Test: client.test.js | `test` `whatsapp` |
| 104 | `tests/whatsapp/client.test.ts` | `test` | Test: client.test.ts | `test` `whatsapp` |
| 105 | `tests/whatsapp/clientInit.test.js` | `test` | Test: clientInit.test.js | `test` `whatsapp` |
| 106 | `tests/whatsapp/clientInit.test.ts` | `test` | Test: clientInit.test.ts | `test` `whatsapp` |
| 107 | `tests/whatsappConfirmedOrder.test.ts` | `test` | Test: whatsappConfirmedOrder.test.ts | `test` `whatsapp` |
| 108 | `tests/whatsappConfirmedOrderStaging.test.ts` | `test` | Test: whatsappConfirmedOrderStaging.test.ts | `test` `whatsapp` |
| 109 | `tests/whatsappGuidancePrompt.test.ts` | `test` | Test: whatsappGuidancePrompt.test.ts | `test` `whatsapp` |
| 110 | `tests/whatsappIntentGate.test.ts` | `test` | Test: whatsappIntentGate.test.ts | `test` `whatsapp` |
| 111 | `tests/whatsappOtpIdentity.test.ts` | `test` | Test: whatsappOtpIdentity.test.ts | `test` `whatsapp` |
| 112 | `tests/whatsappPipeline.test.ts` | `test` | Test: whatsappPipeline.test.ts | `test` `whatsapp` |
| 113 | `tests/whatsappPromoFilter.test.ts` | `test` | Test: whatsappPromoFilter.test.ts | `test` `whatsapp` |
| 114 | `tests/whatsappQueue.test.ts` | `test` | Test: whatsappQueue.test.ts | `test` `whatsapp` |
| 115 | `tests/whatsappRouting.test.ts` | `test` | Test: whatsappRouting.test.ts | `test` `whatsapp` |

### Documentation Layer — `layer:documentation`

<small style="color:#6b7280">14 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `docs/api_endpoints.md` | `document` | Documentation: api_endpoints.md | `documentation` |
| 2 | `docs/ARCHITECTURE.md` | `document` | Documentation: ARCHITECTURE.md | `documentation` |
| 3 | `docs/DATABASE_ARCHITECTURE.md` | `document` | Documentation: DATABASE_ARCHITECTURE.md | `documentation` |
| 4 | `docs/HOW_IT_WORKS.md` | `document` | Documentation: HOW_IT_WORKS.md | `documentation` |
| 5 | `docs/KNOWLEDGE_GRAPH_DOCUMENTATION.md` | `document` | Documentation: KNOWLEDGE_GRAPH_DOCUMENTATION.md | `documentation` |
| 6 | `docs/LOGICAL_WORKFLOWS_AND_BATCH_PATIENT_SPEC.md` | `document` | Documentation: LOGICAL_WORKFLOWS_AND_BATCH_PATIENT_SPEC.md | `documentation` |
| 7 | `docs/MOBILE_APP_CONTEXT.md` | `document` | Documentation: MOBILE_APP_CONTEXT.md | `documentation` |
| 8 | `docs/PRODUCTION_READINESS_CHECKLIST.md` | `document` | Documentation: PRODUCTION_READINESS_CHECKLIST.md | `documentation` |
| 9 | `docs/PROJECT_PAGE_AUDIT_DIRECTORY.md` | `document` | Documentation: PROJECT_PAGE_AUDIT_DIRECTORY.md | `documentation` |
| 10 | `docs/samples/telegram_sample_message.txt` | `document` | Source file: telegram_sample_message.txt | `documentation` `telegram` |
| 11 | `docs/samples/whatsapp_sample_message.txt` | `document` | Source file: whatsapp_sample_message.txt | `documentation` `whatsapp` |
| 12 | `docs/superpowers/plans/2026-08-27-whatsapp-automation-hub.md` | `document` | Documentation: 2026-08-27-whatsapp-automation-hub.md | `documentation` `whatsapp` |
| 13 | `docs/superpowers/specs/2026-08-27-whatsapp-automation-hub-design.md` | `document` | Documentation: 2026-08-27-whatsapp-automation-hub-design.md | `documentation` `whatsapp` |
| 14 | `docs/TEST_BASELINE.md` | `document` | Documentation: TEST_BASELINE.md | `documentation` |

### Script Layer — `layer:scripts`

<small style="color:#14b8a6">224 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `scripts/activate_calpol.mjs` | `file` | Source file: activate_calpol.mjs | `general` |
| 2 | `scripts/all_541_rejected.json` | `file` | Configuration: all_541_rejected.json | `general` |
| 3 | `scripts/analyze_534.mjs` | `file` | Source file: analyze_534.mjs | `general` |
| 4 | `scripts/analyze_rejected_names.mjs` | `file` | Source file: analyze_rejected_names.mjs | `general` |
| 5 | `scripts/analyze_rejected.mjs` | `file` | Source file: analyze_rejected.mjs | `general` |
| 6 | `scripts/analyze-frontend-bundle.mjs` | `file` | Source file: analyze-frontend-bundle.mjs | `general` |
| 7 | `scripts/apply_exact_strength_corrections.mjs` | `file` | Source file: apply_exact_strength_corrections.mjs | `general` |
| 8 | `scripts/audit_all_catalog_images.mjs` | `file` | Source file: audit_all_catalog_images.mjs | `general` |
| 9 | `scripts/audit_and_clean_catalog_images.ts` | `file` | Source file: audit_and_clean_catalog_images.ts | `general` |
| 10 | `scripts/audit_and_correct_catalog_images.mjs` | `file` | Source file: audit_and_correct_catalog_images.mjs | `general` |
| 11 | `scripts/audit_dispovan.mjs` | `file` | Source file: audit_dispovan.mjs | `general` |
| 12 | `scripts/backfill_migration_returns.mjs` | `file` | Source file: backfill_migration_returns.mjs | `migration` |
| 13 | `scripts/backup-restore-drill.mjs` | `file` | Source file: backup-restore-drill.mjs | `general` |
| 14 | `scripts/backup.mjs` | `file` | Source file: backup.mjs | `general` |
| 15 | `scripts/batch_20_redownload.ts` | `file` | Source file: batch_20_redownload.ts | `general` |
| 16 | `scripts/benchmark_aicamera_recognition.ts` | `file` | Source file: benchmark_aicamera_recognition.ts | `ocr` |
| 17 | `scripts/build-medicine-dict.ts` | `file` | Source file: build-medicine-dict.ts | `general` |
| 18 | `scripts/build-update-package.mjs` | `file` | Source file: build-update-package.mjs | `general` |
| 19 | `scripts/buildBundle.cjs` | `file` | Source file: buildBundle.cjs | `general` |
| 20 | `scripts/buildSea.cjs` | `file` | Source file: buildSea.cjs | `general` |
| 21 | `scripts/buildUniversalCatalog.mjs` | `file` | Source file: buildUniversalCatalog.mjs | `general` |
| 22 | `scripts/categorize_rejected.mjs` | `file` | Source file: categorize_rejected.mjs | `general` |
| 23 | `scripts/check_all_api_keys.mjs` | `file` | Source file: check_all_api_keys.mjs | `general` |
| 24 | `scripts/check_all_dytor_resolved_images.mjs` | `file` | Source file: check_all_dytor_resolved_images.mjs | `general` |
| 25 | `scripts/check_api_key.ts` | `file` | Source file: check_api_key.ts | `general` |
| 26 | `scripts/check_candidate_rows.mjs` | `file` | Source file: check_candidate_rows.mjs | `general` |
| 27 | `scripts/check_counts.mjs` | `file` | Source file: check_counts.mjs | `general` |
| 28 | `scripts/check_dytor_cross.mjs` | `file` | Source file: check_dytor_cross.mjs | `general` |
| 29 | `scripts/check_dytor_mismatches.mjs` | `file` | Source file: check_dytor_mismatches.mjs | `general` |
| 30 | `scripts/check_dytor_pe.mjs` | `file` | Source file: check_dytor_pe.mjs | `general` |
| 31 | `scripts/check_dytor_source.mjs` | `file` | Source file: check_dytor_source.mjs | `general` |
| 32 | `scripts/check_dytor_state_exact.mjs` | `file` | Source file: check_dytor_state_exact.mjs | `general` |
| 33 | `scripts/check_dytor_stock.mjs` | `file` | Source file: check_dytor_stock.mjs | `general` |
| 34 | `scripts/check_dytor_substitutes.mjs` | `file` | Source file: check_dytor_substitutes.mjs | `general` |
| 35 | `scripts/check_dytor10_pe.mjs` | `file` | Source file: check_dytor10_pe.mjs | `general` |
| 36 | `scripts/check_dytor10_side2.mjs` | `file` | Source file: check_dytor10_side2.mjs | `general` |
| 37 | `scripts/check_dytor20_db.mjs` | `file` | Source file: check_dytor20_db.mjs | `general` |
| 38 | `scripts/check_existing_files.mjs` | `file` | Source file: check_existing_files.mjs | `general` |
| 39 | `scripts/check_filename_matches.mjs` | `file` | Source file: check_filename_matches.mjs | `general` |
| 40 | `scripts/check_gemini_quota.mjs` | `file` | Source file: check_gemini_quota.mjs | `general` |
| 41 | `scripts/check_honey_row.mjs` | `file` | Source file: check_honey_row.mjs | `general` |
| 42 | `scripts/check_live_pe.mjs` | `file` | Source file: check_live_pe.mjs | `general` |
| 43 | `scripts/check_local_matches.mjs` | `file` | Source file: check_local_matches.mjs | `general` |
| 44 | `scripts/check_med_cols.mjs` | `file` | Source file: check_med_cols.mjs | `general` |
| 45 | `scripts/check_rejected_on_disk.mjs` | `file` | Source file: check_rejected_on_disk.mjs | `general` |
| 46 | `scripts/check_stock_query.mjs` | `file` | Source file: check_stock_query.mjs | `general` |
| 47 | `scripts/classify_292.mjs` | `file` | Source file: classify_292.mjs | `general` |
| 48 | `scripts/classify_true_clinical_errors.mjs` | `file` | Source file: classify_true_clinical_errors.mjs | `general` |
| 49 | `scripts/classifyDrugSchedules.ts` | `file` | Source file: classifyDrugSchedules.ts | `general` |
| 50 | `scripts/clean_all_remaining_images.mjs` | `file` | Source file: clean_all_remaining_images.mjs | `general` |
| 51 | `scripts/clean_temp.mjs` | `file` | Source file: clean_temp.mjs | `general` |
| 52 | `scripts/cleanupDuplicateMedicines.mjs` | `file` | Source file: cleanupDuplicateMedicines.mjs | `general` |
| 53 | `scripts/clear-all-data.mjs` | `file` | Source file: clear-all-data.mjs | `general` |
| 54 | `scripts/createLicense.mjs` | `file` | Source file: createLicense.mjs | `general` |
| 55 | `scripts/cross-check-images-aicamera.ts` | `file` | Source file: cross-check-images-aicamera.ts | `ocr` |
| 56 | `scripts/debug_confidence.mjs` | `file` | Source file: debug_confidence.mjs | `general` |
| 57 | `scripts/debug_single_match.mjs` | `file` | Source file: debug_single_match.mjs | `general` |
| 58 | `scripts/deleteLicense.mjs` | `file` | Source file: deleteLicense.mjs | `general` |
| 59 | `scripts/diagnose_scoring.mjs` | `file` | Source file: diagnose_scoring.mjs | `general` |
| 60 | `scripts/download_20_catalog_images.ts` | `file` | Source file: download_20_catalog_images.ts | `general` |
| 61 | `scripts/download_7_refs.mjs` | `file` | Source file: download_7_refs.mjs | `general` |
| 62 | `scripts/download_core_refs.mjs` | `file` | Source file: download_core_refs.mjs | `general` |
| 63 | `scripts/download_genuine_dytor20.mjs` | `file` | Source file: download_genuine_dytor20.mjs | `general` |
| 64 | `scripts/download_more_refs.mjs` | `file` | Source file: download_more_refs.mjs | `general` |
| 65 | `scripts/download_onnx_models.mjs` | `file` | Source file: download_onnx_models.mjs | `general` |
| 66 | `scripts/download_verified_items.mjs` | `file` | Source file: download_verified_items.mjs | `general` |
| 67 | `scripts/download-inventory-images.mjs` | `file` | Source file: download-inventory-images.mjs | `general` |
| 68 | `scripts/dump_534.mjs` | `file` | Source file: dump_534.mjs | `general` |
| 69 | `scripts/dump_all_rejected.mjs` | `file` | Source file: dump_all_rejected.mjs | `general` |
| 70 | `scripts/dump_rejected_meds.mjs` | `file` | Source file: dump_rejected_meds.mjs | `general` |
| 71 | `scripts/dump_unique_rejected.mjs` | `file` | Source file: dump_unique_rejected.mjs | `general` |
| 72 | `scripts/enrich-clinical-knowledge.mjs` | `file` | Source file: enrich-clinical-knowledge.mjs | `general` |
| 73 | `scripts/export-not-found-products.mjs` | `file` | Source file: export-not-found-products.mjs | `general` |
| 74 | `scripts/extract-clinical-categories.mjs` | `file` | Source file: extract-clinical-categories.mjs | `general` |
| 75 | `scripts/extract-styles.mjs` | `file` | Source file: extract-styles.mjs | `general` |
| 76 | `scripts/final_unresolved.json` | `file` | Configuration: final_unresolved.json | `general` |
| 77 | `scripts/find_all_subtle_mismatches.mjs` | `file` | Source file: find_all_subtle_mismatches.mjs | `general` |
| 78 | `scripts/find_confirmed_mismatches.mjs` | `file` | Source file: find_confirmed_mismatches.mjs | `general` |
| 79 | `scripts/find_mismatched_images.mjs` | `file` | Source file: find_mismatched_images.mjs | `general` |
| 80 | `scripts/find_popular_meds.ts` | `file` | Source file: find_popular_meds.ts | `general` |
| 81 | `scripts/find_rejected_meds.mjs` | `file` | Source file: find_rejected_meds.mjs | `general` |
| 82 | `scripts/fix_dytor_catalog_images.mjs` | `file` | Source file: fix_dytor_catalog_images.mjs | `general` |
| 83 | `scripts/fix_legacy_catalog_images.ts` | `file` | Source file: fix_legacy_catalog_images.ts | `general` |
| 84 | `scripts/generate_missing_website_products_report.mjs` | `file` | Source file: generate_missing_website_products_report.mjs | `general` |
| 85 | `scripts/generate-3d-graph.mjs` | `file` | Source file: generate-3d-graph.mjs | `general` |
| 86 | `scripts/generate-project-docs.mjs` | `file` | Source file: generate-project-docs.mjs | `general` |
| 87 | `scripts/get_top_companies.mjs` | `file` | Source file: get_top_companies.mjs | `general` |
| 88 | `scripts/group_needs_download.mjs` | `file` | Source file: group_needs_download.mjs | `general` |
| 89 | `scripts/group_rejected_identities.mjs` | `file` | Source file: group_rejected_identities.mjs | `general` |
| 90 | `scripts/harvest_top100_company_images.ts` | `file` | Source file: harvest_top100_company_images.ts | `general` |
| 91 | `scripts/heal-sales-gst.js` | `file` | Source file: heal-sales-gst.js | `general` |
| 92 | `scripts/heal-sales-invoices.js` | `file` | Source file: heal-sales-invoices.js | `invoice` |
| 93 | `scripts/importCatalog.ts` | `file` | Source file: importCatalog.ts | `general` |
| 94 | `scripts/importMasterMedicines.mjs` | `file` | Source file: importMasterMedicines.mjs | `general` |
| 95 | `scripts/importMedicineNames.mjs` | `file` | Source file: importMedicineNames.mjs | `general` |
| 96 | `scripts/inspect_abzorb.mjs` | `file` | Source file: inspect_abzorb.mjs | `general` |
| 97 | `scripts/inspect_brands.mjs` | `file` | Source file: inspect_brands.mjs | `general` |
| 98 | `scripts/inspect_calpol_ocr.mjs` | `file` | Source file: inspect_calpol_ocr.mjs | `ocr` |
| 99 | `scripts/inspect_calpol.mjs` | `file` | Source file: inspect_calpol.mjs | `general` |
| 100 | `scripts/inspect_catalog_images.ts` | `file` | Source file: inspect_catalog_images.ts | `general` |
| 101 | `scripts/inspect_dytor_all.mjs` | `file` | Source file: inspect_dytor_all.mjs | `general` |
| 102 | `scripts/inspect_dytor_head.mjs` | `file` | Source file: inspect_dytor_head.mjs | `general` |
| 103 | `scripts/inspect_dytor_state.mjs` | `file` | Source file: inspect_dytor_state.mjs | `general` |
| 104 | `scripts/inspect_dytor.mjs` | `file` | Source file: inspect_dytor.mjs | `general` |
| 105 | `scripts/inspect_him_oil.mjs` | `file` | Source file: inspect_him_oil.mjs | `general` |
| 106 | `scripts/inspect_honey_db.mjs` | `file` | Source file: inspect_honey_db.mjs | `general` |
| 107 | `scripts/inspect_issues.mjs` | `file` | Source file: inspect_issues.mjs | `general` |
| 108 | `scripts/inspect_other_items.mjs` | `file` | Source file: inspect_other_items.mjs | `general` |
| 109 | `scripts/inspect_reasons.mjs` | `file` | Source file: inspect_reasons.mjs | `general` |
| 110 | `scripts/inspect_rejected.mjs` | `file` | Source file: inspect_rejected.mjs | `general` |
| 111 | `scripts/inspect_unresolved_292.mjs` | `file` | Source file: inspect_unresolved_292.mjs | `general` |
| 112 | `scripts/list_all_tables.mjs` | `file` | Source file: list_all_tables.mjs | `general` |
| 113 | `scripts/local_verified.json` | `file` | Configuration: local_verified.json | `general` |
| 114 | `scripts/migrate_catalog_images_to_company_folders.ts` | `file` | Source file: migrate_catalog_images_to_company_folders.ts | `general` |
| 115 | `scripts/migrate_v53.ts` | `file` | Source file: migrate_v53.ts | `general` |
| 116 | `scripts/migrate.js` | `file` | Source file: migrate.js | `general` |
| 117 | `scripts/needs_download.json` | `file` | Configuration: needs_download.json | `general` |
| 118 | `scripts/normalizeSpecialOrderPhones.mjs` | `file` | Source file: normalizeSpecialOrderPhones.mjs | `general` |
| 119 | `scripts/ocr_dytors.mjs` | `file` | Source file: ocr_dytors.mjs | `ocr` |
| 120 | `scripts/performance-guardrails.mjs` | `file` | Source file: performance-guardrails.mjs | `general` |
| 121 | `scripts/pick_20_medicines.ts` | `file` | Source file: pick_20_medicines.ts | `general` |
| 122 | `scripts/print_parachute_imgs.mjs` | `file` | Source file: print_parachute_imgs.mjs | `general` |
| 123 | `scripts/print_strength_clashes.mjs` | `file` | Source file: print_strength_clashes.mjs | `general` |
| 124 | `scripts/purge_bad_harvested_images.cjs` | `file` | Source file: purge_bad_harvested_images.cjs | `general` |
| 125 | `scripts/purge_mismatched_images.mjs` | `file` | Source file: purge_mismatched_images.mjs | `general` |
| 126 | `scripts/purge_old_images.mjs` | `file` | Source file: purge_old_images.mjs | `general` |
| 127 | `scripts/quick-update.mjs` | `file` | Source file: quick-update.mjs | `general` |
| 128 | `scripts/redownload_and_run_ai_camera.ts` | `file` | Source file: redownload_and_run_ai_camera.ts | `ocr` |
| 129 | `scripts/redownload_and_verify_rejected.ts` | `file` | Source file: redownload_and_verify_rejected.ts | `general` |
| 130 | `scripts/redownload_and_verify.ts` | `file` | Source file: redownload_and_verify.ts | `general` |
| 131 | `scripts/refetch_with_accurate_names.mjs` | `file` | Source file: refetch_with_accurate_names.mjs | `general` |
| 132 | `scripts/rejected_534.json` | `file` | Configuration: rejected_534.json | `general` |
| 133 | `scripts/rejected_meds_list.json` | `file` | Configuration: rejected_meds_list.json | `general` |
| 134 | `scripts/release.mjs` | `file` | Source file: release.mjs | `general` |
| 135 | `scripts/reload_harvesters.mjs` | `file` | Source file: reload_harvesters.mjs | `general` |
| 136 | `scripts/remaining_unresolved.json` | `file` | Configuration: remaining_unresolved.json | `general` |
| 137 | `scripts/resetLicense.mjs` | `file` | Source file: resetLicense.mjs | `general` |
| 138 | `scripts/resolve_all_111.mjs` | `file` | Source file: resolve_all_111.mjs | `general` |
| 139 | `scripts/resolve_all_final.mjs` | `file` | Source file: resolve_all_final.mjs | `general` |
| 140 | `scripts/resolve_all_rejected.mjs` | `file` | Source file: resolve_all_rejected.mjs | `general` |
| 141 | `scripts/resolve_final_135.mjs` | `file` | Source file: resolve_final_135.mjs | `general` |
| 142 | `scripts/resolve_master_catalog.mjs` | `file` | Source file: resolve_master_catalog.mjs | `general` |
| 143 | `scripts/resolve_quarantined_66.mjs` | `file` | Source file: resolve_quarantined_66.mjs | `general` |
| 144 | `scripts/resolve_true_mismatches.mjs` | `file` | Source file: resolve_true_mismatches.mjs | `general` |
| 145 | `scripts/restore.mjs` | `file` | Source file: restore.mjs | `general` |
| 146 | `scripts/retry-not-found-images.mjs` | `file` | Source file: retry-not-found-images.mjs | `general` |
| 147 | `scripts/scan_all_downloaded_images.ts` | `file` | Source file: scan_all_downloaded_images.ts | `general` |
| 148 | `scripts/scan_and_resolve_primary_images.mjs` | `file` | Source file: scan_and_resolve_primary_images.mjs | `general` |
| 149 | `scripts/scan_db_images_accuracy.ts` | `file` | Source file: scan_db_images_accuracy.ts | `general` |
| 150 | `scripts/search_apollo.mjs` | `file` | Source file: search_apollo.mjs | `general` |
| 151 | `scripts/search_live.mjs` | `file` | Source file: search_live.mjs | `general` |
| 152 | `scripts/seed_inventory_medicines.mjs` | `file` | Source file: seed_inventory_medicines.mjs | `general` |
| 153 | `scripts/show_135.mjs` | `file` | Source file: show_135.mjs | `general` |
| 154 | `scripts/show_other.mjs` | `file` | Source file: show_other.mjs | `general` |
| 155 | `scripts/start-online-catalog-tunnel.mjs` | `file` | Source file: start-online-catalog-tunnel.mjs | `general` |
| 156 | `scripts/summarize_real_errors.mjs` | `file` | Source file: summarize_real_errors.mjs | `general` |
| 157 | `scripts/sync-multi-angles.mjs` | `file` | Source file: sync-multi-angles.mjs | `general` |
| 158 | `scripts/test_1mg_dytor.mjs` | `file` | Test: test_1mg_dytor.mjs | `general` |
| 159 | `scripts/test_1mg.mjs` | `file` | Test: test_1mg.mjs | `general` |
| 160 | `scripts/test_ai_camera_10.ts` | `file` | Test: test_ai_camera_10.ts | `ocr` |
| 161 | `scripts/test_aicamera_improvements.ts` | `file` | Test: test_aicamera_improvements.ts | `ocr` |
| 162 | `scripts/test_aicamera_strength_confirmation.mjs` | `file` | Test: test_aicamera_strength_confirmation.mjs | `ocr` |
| 163 | `scripts/test_apis.mjs` | `file` | Test: test_apis.mjs | `general` |
| 164 | `scripts/test_apollo_img.mjs` | `file` | Test: test_apollo_img.mjs | `general` |
| 165 | `scripts/test_batch_search.mjs` | `file` | Test: test_batch_search.mjs | `general` |
| 166 | `scripts/test_brand_expansion.mjs` | `file` | Test: test_brand_expansion.mjs | `general` |
| 167 | `scripts/test_brand_filtering.ts` | `file` | Test: test_brand_filtering.ts | `general` |
| 168 | `scripts/test_calpol_pe.mjs` | `file` | Test: test_calpol_pe.mjs | `general` |
| 169 | `scripts/test_cdn_urls.mjs` | `file` | Test: test_cdn_urls.mjs | `general` |
| 170 | `scripts/test_cipladine_search.mjs` | `file` | Test: test_cipladine_search.mjs | `general` |
| 171 | `scripts/test_clinical_resolver.mjs` | `file` | Test: test_clinical_resolver.mjs | `general` |
| 172 | `scripts/test_device_conflict.ts` | `file` | Test: test_device_conflict.ts | `general` |
| 173 | `scripts/test_dispovan_apollo.mjs` | `file` | Test: test_dispovan_apollo.mjs | `general` |
| 174 | `scripts/test_dispovan.mjs` | `file` | Test: test_dispovan.mjs | `general` |
| 175 | `scripts/test_download_10_random.ts` | `file` | Test: test_download_10_random.ts | `general` |
| 176 | `scripts/test_enhanced_resolver.mjs` | `file` | Test: test_enhanced_resolver.mjs | `general` |
| 177 | `scripts/test_fast_offline_ocr.ts` | `file` | Test: test_fast_offline_ocr.ts | `ocr` |
| 178 | `scripts/test_flamingo_cotton.ts` | `file` | Test: test_flamingo_cotton.ts | `general` |
| 179 | `scripts/test_honey.mjs` | `file` | Test: test_honey.mjs | `general` |
| 180 | `scripts/test_icloud_prescription.ts` | `file` | Test: test_icloud_prescription.ts | `general` |
| 181 | `scripts/test_image_compression.ts` | `file` | Test: test_image_compression.ts | `general` |
| 182 | `scripts/test_image_correction.mjs` | `file` | Test: test_image_correction.mjs | `general` |
| 183 | `scripts/test_insulin_download.ts` | `file` | Test: test_insulin_download.ts | `general` |
| 184 | `scripts/test_inventory_10.ts` | `file` | Test: test_inventory_10.ts | `general` |
| 185 | `scripts/test_netmeds_search.mjs` | `file` | Test: test_netmeds_search.mjs | `general` |
| 186 | `scripts/test_netmeds.mjs` | `file` | Test: test_netmeds.mjs | `general` |
| 187 | `scripts/test_offline_prescription_matcher.ts` | `file` | Test: test_offline_prescription_matcher.ts | `general` |
| 188 | `scripts/test_onnx_ocr.ts` | `file` | Test: test_onnx_ocr.ts | `ocr` |
| 189 | `scripts/test_other_sources.mjs` | `file` | Test: test_other_sources.mjs | `general` |
| 190 | `scripts/test_parachute_match.mjs` | `file` | Test: test_parachute_match.mjs | `general` |
| 191 | `scripts/test_pe_cdn.mjs` | `file` | Test: test_pe_cdn.mjs | `general` |
| 192 | `scripts/test_prefixed_dict.ts` | `file` | Test: test_prefixed_dict.ts | `general` |
| 193 | `scripts/test_prescription_intel_flow.ts` | `file` | Test: test_prescription_intel_flow.ts | `general` |
| 194 | `scripts/test_query_generator.mjs` | `file` | Test: test_query_generator.mjs | `general` |
| 195 | `scripts/test_rest_search.mjs` | `file` | Test: test_rest_search.mjs | `general` |
| 196 | `scripts/test_sample_rx.ts` | `file` | Test: test_sample_rx.ts | `general` |
| 197 | `scripts/test_save_image.mjs` | `file` | Test: test_save_image.mjs | `general` |
| 198 | `scripts/test_search_dytor20.mjs` | `file` | Test: test_search_dytor20.mjs | `general` |
| 199 | `scripts/test_search_honey.mjs` | `file` | Test: test_search_honey.mjs | `general` |
| 200 | `scripts/test_sources.mjs` | `file` | Test: test_sources.mjs | `general` |
| 201 | `scripts/test_ssr_20.mjs` | `file` | Test: test_ssr_20.mjs | `general` |
| 202 | `scripts/test_ssr_search.mjs` | `file` | Test: test_ssr_search.mjs | `general` |
| 203 | `scripts/train-ai-camera.ts` | `file` | Source file: train-ai-camera.ts | `ocr` |
| 204 | `scripts/unique_rejected_meds.json` | `file` | Configuration: unique_rejected_meds.json | `general` |
| 205 | `scripts/verify_aicamera_image_improvements.ts` | `file` | Source file: verify_aicamera_image_improvements.ts | `ocr` |
| 206 | `scripts/verify_disk_images.mjs` | `file` | Source file: verify_disk_images.mjs | `general` |
| 207 | `scripts/verify_universal_catalog.mjs` | `file` | Source file: verify_universal_catalog.mjs | `general` |
| 208 | `scripts/verify-isolation.mjs` | `file` | Source file: verify-isolation.mjs | `general` |
| 209 | `scripts/watchdog.mjs` | `file` | Source file: watchdog.mjs | `general` |
| 210 | `src/cli/enqueueCatalog.ts` | `file` | Source file: enqueueCatalog.ts | `general` |
| 211 | `src/cli/watchCatalog.ts` | `file` | Source file: watchCatalog.ts | `general` |
| 212 | `src/scripts/benchmarkPerformance.ts` | `file` | Source file: benchmarkPerformance.ts | `general` |
| 213 | `src/scripts/check_email.ts` | `file` | Source file: check_email.ts | `email` |
| 214 | `src/scripts/fixDb.ts` | `file` | Source file: fixDb.ts | `general` |
| 215 | `src/scripts/injectStyles.ts` | `file` | Source file: injectStyles.ts | `general` |
| 216 | `src/scripts/inspect_purchases_sequence.ts` | `file` | Source file: inspect_purchases_sequence.ts | `general` |
| 217 | `src/scripts/migrateItemCodes.ts` | `file` | Source file: migrateItemCodes.ts | `general` |
| 218 | `src/scripts/seedCompanies.ts` | `file` | Source file: seedCompanies.ts | `general` |
| 219 | `src/scripts/seedIndianMeds.ts` | `file` | Source file: seedIndianMeds.ts | `general` |
| 220 | `src/scripts/seedMassiveMeds.ts` | `file` | Source file: seedMassiveMeds.ts | `general` |
| 221 | `src/scripts/seedPdfs.ts` | `file` | Source file: seedPdfs.ts | `general` |
| 222 | `src/scripts/seedRealMeds.ts` | `file` | Source file: seedRealMeds.ts | `general` |
| 223 | `src/scripts/seedWhoMeds.ts` | `file` | Source file: seedWhoMeds.ts | `general` |
| 224 | `src/scripts/testMigration.ts` | `file` | Test: testMigration.ts | `general` |

### Configuration Layer — `layer:configuration`

<small style="color:#84cc16">220 node(s) in graph</small>

#### Files

| # | Path | Type | Summary | Tags |
|---|---|---|---|---|
| 1 | `__mocks__/sqlite3.js` | `file` | Source file: sqlite3.js | `general` |
| 2 | `.agents/rules/automated-release.md` | `document` | Documentation: automated-release.md | `documentation` |
| 3 | `.agents/rules/backend-schema-safety.md` | `document` | Documentation: backend-schema-safety.md | `documentation` |
| 4 | `.agents/rules/bug-fix.md` | `document` | Documentation: bug-fix.md | `documentation` |
| 5 | `.agents/rules/legitimate-data-audit.md` | `document` | Documentation: legitimate-data-audit.md | `documentation` |
| 6 | `.agents/rules/medicine-image-accuracy.md` | `document` | Documentation: medicine-image-accuracy.md | `documentation` |
| 7 | `.agents/rules/ponytail.md` | `document` | Documentation: ponytail.md | `documentation` |
| 8 | `.agents/skills/cf-skill/SKILL.md` | `document` | Documentation: SKILL.md | `documentation` |
| 9 | `.cursor/settings.json` | `config` | Configuration: settings.json | `config` |
| 10 | `.opencode/package.json` | `config` | Configuration: package.json | `config` |
| 11 | `.opencode/plans/pos-cart-first-keyboard-flow.md` | `document` | Documentation: pos-cart-first-keyboard-flow.md | `documentation` |
| 12 | `.opencode/plans/pos-doctor-suggestions-refill-distinction.md` | `document` | Documentation: pos-doctor-suggestions-refill-distinction.md | `documentation` |
| 13 | `.vscode/launch.json` | `config` | Configuration: launch.json | `config` |
| 14 | `.vscode/settings.json` | `config` | Configuration: settings.json | `config` |
| 15 | `.wwebjs_cache/2.3000.1047982283.html` | `file` | Source file: 2.3000.1047982283.html | `general` |
| 16 | `.wwebjs_cache/2.3000.1047984038.html` | `file` | Source file: 2.3000.1047984038.html | `general` |
| 17 | `.wwebjs_cache/2.3000.1047997672.html` | `file` | Source file: 2.3000.1047997672.html | `general` |
| 18 | `.wwebjs_cache/2.3000.1047999808.html` | `file` | Source file: 2.3000.1047999808.html | `general` |
| 19 | `.wwebjs_cache/2.3000.1048010689.html` | `file` | Source file: 2.3000.1048010689.html | `general` |
| 20 | `.wwebjs_cache/2.3000.1048128565.html` | `file` | Source file: 2.3000.1048128565.html | `general` |
| 21 | `.wwebjs_cache/2.3000.1048136787.html` | `file` | Source file: 2.3000.1048136787.html | `general` |
| 22 | `.wwebjs_cache/2.3000.1048143467.html` | `file` | Source file: 2.3000.1048143467.html | `general` |
| 23 | `.wwebjs_cache/2.3000.1048152143.html` | `file` | Source file: 2.3000.1048152143.html | `general` |
| 24 | `2ND.MD` | `document` | Source file: 2ND.MD | `documentation` |
| 25 | `3d-knowledge-graph.html` | `file` | Source file: 3d-knowledge-graph.html | `general` |
| 26 | `AGENT_BUG_FIX_RULEBOOK.md` | `document` | Documentation: AGENT_BUG_FIX_RULEBOOK.md | `documentation` |
| 27 | `AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` |
| 28 | `AI Pharmacy V3 — Safe In-Place Application Upgrade Implementation Plan.md` | `document` | Documentation: AI Pharmacy V3 — Safe In-Place Application Upgrade Implementation Plan.md | `documentation` |
| 29 | `all_downloaded_images_conflict_report.json` | `config` | Configuration: all_downloaded_images_conflict_report.json | `config` |
| 30 | `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` | `document` | Documentation: API_OPTIMIZATION_IMPLEMENTATION_PLAN.md | `documentation` |
| 31 | `api/_db.js` | `file` | Source file: _db.js | `general` |
| 32 | `api/catalog.js` | `file` | Source file: catalog.js | `general` |
| 33 | `api/license.js` | `file` | Source file: license.js | `auth` |
| 34 | `api/telemetry.js` | `file` | Source file: telemetry.js | `general` |
| 35 | `api/updates.js` | `file` | Source file: updates.js | `general` |
| 36 | `APP.MD` | `document` | Source file: APP.MD | `documentation` |
| 37 | `Apply 20 UX Laws to the EXISTING application workflow.md` | `document` | Documentation: Apply 20 UX Laws to the EXISTING application workflow.md | `documentation` |
| 38 | `Auto Add to Live Cart.md` | `document` | Documentation: Auto Add to Live Cart.md | `documentation` |
| 39 | `autosend whsapp message.md` | `document` | Documentation: autosend whsapp message.md | `documentation` |
| 40 | `BACKEND SCHEMA SAFETY.md` | `document` | Documentation: BACKEND SCHEMA SAFETY.md | `documentation` |
| 41 | `bootstrapper/main.ts` | `file` | Source file: main.ts | `general` |
| 42 | `bootstrapper/package.json` | `config` | Configuration: package.json | `config` |
| 43 | `BUG_FIX_RULE_GUIDE.md` | `document` | Documentation: BUG_FIX_RULE_GUIDE.md | `documentation` |
| 44 | `build_reference.mjs` | `file` | Source file: build_reference.mjs | `general` |
| 45 | `CATALOGUE IMAGE CONNECTION + AI MATCHING + HUMAN VERIFICATION + AUTO-CORRECTION.md` | `document` | Documentation: CATALOGUE IMAGE CONNECTION + AI MATCHING + HUMAN VERIFICATION + AUTO-CORRECTION.md | `documentation` |
| 46 | `CENTRALIZED CATALOG + BOOKING/PICKUP WORKFLOW.md` | `document` | Documentation: PICKUP WORKFLOW.md | `documentation` |
| 47 | `check_console.js` | `file` | Source file: check_console.js | `general` |
| 48 | `check_db.mjs` | `file` | Source file: check_db.mjs | `general` |
| 49 | `check_purchase.mjs` | `file` | Source file: check_purchase.mjs | `general` |
| 50 | `DEDICATED PRODUCT IMAGE CORRECTION & VERIFICATION SYSTEM.md` | `document` | Documentation: DEDICATED PRODUCT IMAGE CORRECTION & VERIFICATION SYSTEM.md | `documentation` |
| 51 | `design-system/ai-pharmacy/MASTER.md` | `document` | Documentation: MASTER.md | `documentation` |
| 52 | `dist-pkg/server.cjs` | `file` | Source file: server.cjs | `general` |
| 53 | `eslint_after.json` | `config` | Configuration: eslint_after.json | `config` |
| 54 | `eslint_baseline.json` | `config` | Configuration: eslint_baseline.json | `config` |
| 55 | `EXISTING INSTALLER + RELEASE + AUTO-UPDATE FIX.md` | `document` | Documentation: EXISTING INSTALLER + RELEASE + AUTO-UPDATE FIX.md | `documentation` |
| 56 | `exports/Chronic_Patient_Monthly_Refill_Catalog.html` | `file` | Source file: Chronic_Patient_Monthly_Refill_Catalog.html | `general` |
| 57 | `exports/Live_Pharmacy_Catalog_Website.html` | `file` | Source file: Live_Pharmacy_Catalog_Website.html | `general` |
| 58 | `exports/Pharmacy_Product_Catalog.html` | `file` | Source file: Pharmacy_Product_Catalog.html | `general` |
| 59 | `Fast, Reliable and Centralized Database Save Handling.MD` | `document` | Source file: Fast, Reliable and Centralized Database Save Handling.MD | `documentation` |
| 60 | `FINAL_BENCHMARK_AUDIT_REPORT.md` | `document` | Documentation: FINAL_BENCHMARK_AUDIT_REPORT.md | `documentation` |
| 61 | `FINAL_IMAGE_REPORT.md` | `document` | Documentation: FINAL_IMAGE_REPORT.md | `documentation` |
| 62 | `FIX WHATSAPP CONFIRMED ORDER → PHARMARACK LIVE C.md` | `document` | Documentation: FIX WHATSAPP CONFIRMED ORDER → PHARMARACK LIVE C.md | `documentation` |
| 63 | `FRONTEND PERFORMANCE FIX.md` | `document` | Documentation: FRONTEND PERFORMANCE FIX.md | `documentation` |
| 64 | `gas/licenseServer.js` | `file` | Source file: licenseServer.js | `auth` |
| 65 | `gas/README.md` | `document` | Documentation: README.md | `documentation` |
| 66 | `heal_db.js` | `file` | Source file: heal_db.js | `general` |
| 67 | `idealstate.md` | `document` | Documentation: idealstate.md | `documentation` |
| 68 | `import_reference.mjs` | `file` | Source file: import_reference.mjs | `general` |
| 69 | `Inactive Page Suspension + Targeted Data Refresh + UI Performance Optimization.MD` | `document` | Source file: Inactive Page Suspension + Targeted Data Refresh + UI Performance Optimization.MD | `documentation` |
| 70 | `Incoming Message Relevance + Promotional Message Filtering.md` | `document` | Documentation: Incoming Message Relevance + Promotional Message Filtering.md | `documentation` |
| 71 | `index.js` | `file` | Source file: index.js | `general` |
| 72 | `INSTANT PAGE NAVIGATION + WARM CACHE + SILENT BACKGROUND DATA REFRESH.md` | `document` | Documentation: INSTANT PAGE NAVIGATION + WARM CACHE + SILENT BACKGROUND DATA REFRESH.md | `documentation` |
| 73 | `jest.config.js` | `file` | Source file: jest.config.js | `general` |
| 74 | `license.txt` | `file` | Source file: license.txt | `auth` |
| 75 | `MULTI-PHARMACY.md` | `document` | Documentation: MULTI-PHARMACY.md | `documentation` |
| 76 | `Multi-Store Pharmacy Owner Management from Website.md` | `document` | Documentation: Multi-Store Pharmacy Owner Management from Website.md | `documentation` |
| 77 | `ONE UNIVERSAL MEDICINE CATALOG USING THE EXISTING CATALOG + BOTH CSV DATASETS.md` | `document` | Documentation: ONE UNIVERSAL MEDICINE CATALOG USING THE EXISTING CATALOG + BOTH CSV DATASETS.md | `documentation` |
| 78 | `package.json` | `config` | Configuration: package.json | `config` |
| 79 | `packaging/portable.env` | `file` | Source file: portable.env | `general` |
| 80 | `pdf whsapp workflow.md` | `document` | Documentation: pdf whsapp workflow.md | `documentation` |
| 81 | `PERFORMANCE STARTUP & WORKER OPTIMIZATION SPECIFICATION.md` | `document` | Documentation: PERFORMANCE STARTUP & WORKER OPTIMIZATION SPECIFICATION.md | `documentation` |
| 82 | `PERMANENT VERCEL PRODUCTION DEPLOYMENT FIX.md` | `document` | Documentation: PERMANENT VERCEL PRODUCTION DEPLOYMENT FIX.md | `documentation` |
| 83 | `PHARMACY ONLINE ORDER → PAYMENT → LIVE CART → POS → CUSTOMER HISTORY.md` | `document` | Documentation: PHARMACY ONLINE ORDER → PAYMENT → LIVE CART → POS → CUSTOMER HISTORY.md | `documentation` |
| 84 | `PHARMACY ORDER TIMING + DELIVERY ETA + REFILL AUDIT.md` | `document` | Documentation: PHARMACY ORDER TIMING + DELIVERY ETA + REFILL AUDIT.md | `documentation` |
| 85 | `PRESCRIPTION_IMAGE_OCR_DB_MATCH_IMPLEMENTATION_PLAN.md` | `document` | Documentation: PRESCRIPTION_IMAGE_OCR_DB_MATCH_IMPLEMENTATION_PLAN.md | `documentation` |
| 86 | `PRODUCT IMAGE MISSING.MD` | `document` | Source file: PRODUCT IMAGE MISSING.MD | `documentation` |
| 87 | `PRODUCTION WINDOWS INSTALLER + AUTO UPDATE + LICENSE + PILOT/PRODUCTION.md` | `document` | Documentation: PRODUCTION.md | `documentation` |
| 88 | `productResolver.ts` | `file` | Source file: productResolver.ts | `general` |
| 89 | `Purchase Medicine Search.md` | `document` | Documentation: Purchase Medicine Search.md | `documentation` |
| 90 | `python/scan_nlp/requirements.txt` | `file` | Source file: requirements.txt | `general` |
| 91 | `README.md` | `document` | Documentation: README.md | `documentation` |
| 92 | `real_eval.ts` | `file` | Source file: real_eval.ts | `general` |
| 93 | `Reliable Scheduled Distributo.md` | `document` | Documentation: Reliable Scheduled Distributo.md | `documentation` |
| 94 | `rtt/PRESCRIPTION_IMAGE_OCR_DB_MATCH_IMPLEMENTATION_PLAN.md` | `document` | Documentation: PRESCRIPTION_IMAGE_OCR_DB_MATCH_IMPLEMENTATION_PLAN.md | `documentation` |
| 95 | `scan_benchmark.ts` | `file` | Source file: scan_benchmark.ts | `general` |
| 96 | `scanGateAlgorithms.ts` | `file` | Source file: scanGateAlgorithms.ts | `general` |
| 97 | `scratch/aicamera_benchmark_report.json` | `config` | Configuration: aicamera_benchmark_report.json | `config` `ocr` |
| 98 | `scratch/all_valid_keys.json` | `config` | Configuration: all_valid_keys.json | `config` |
| 99 | `scratch/analyze_catalog_inventory.mjs` | `file` | Source file: analyze_catalog_inventory.mjs | `general` |
| 100 | `scratch/check_batch2.cjs` | `file` | Source file: check_batch2.cjs | `general` |
| 101 | `scratch/check_exact_brand.mjs` | `file` | Source file: check_exact_brand.mjs | `general` |
| 102 | `scratch/check_keys.cjs` | `file` | Source file: check_keys.cjs | `general` |
| 103 | `scratch/check_quarantine_on_disk.mjs` | `file` | Source file: check_quarantine_on_disk.mjs | `general` |
| 104 | `scratch/cleanup_purged_files.mjs` | `file` | Source file: cleanup_purged_files.mjs | `general` |
| 105 | `scratch/cross_check_state.mjs` | `file` | Source file: cross_check_state.mjs | `general` |
| 106 | `scratch/filter_keys.cjs` | `file` | Source file: filter_keys.cjs | `general` |
| 107 | `scratch/find_genuine_wrong.mjs` | `file` | Source file: find_genuine_wrong.mjs | `general` |
| 108 | `scratch/get_mfg.cjs` | `file` | Source file: get_mfg.cjs | `general` |
| 109 | `scratch/get_stats.cjs` | `file` | Source file: get_stats.cjs | `general` |
| 110 | `scratch/get_top_mfg.cjs` | `file` | Source file: get_top_mfg.cjs | `general` |
| 111 | `scratch/inspect_db.mjs` | `file` | Source file: inspect_db.mjs | `general` |
| 112 | `scratch/inspect_products_folder.mjs` | `file` | Source file: inspect_products_folder.mjs | `general` |
| 113 | `scratch/inspect_state_json.mjs` | `file` | Source file: inspect_state_json.mjs | `general` |
| 114 | `scratch/list_purged.mjs` | `file` | Source file: list_purged.mjs | `general` |
| 115 | `scratch/pending_overview.cjs` | `file` | Source file: pending_overview.cjs | `general` |
| 116 | `scratch/save_clean_keys.cjs` | `file` | Source file: save_clean_keys.cjs | `general` |
| 117 | `scratch/sniff_1mg.cjs` | `file` | Source file: sniff_1mg.cjs | `general` |
| 118 | `scratch/sniff_headers.cjs` | `file` | Source file: sniff_headers.cjs | `general` |
| 119 | `scratch/tables_with_data.mjs` | `file` | Source file: tables_with_data.mjs | `general` |
| 120 | `scratch/test_batch4.cjs` | `file` | Test: test_batch4.cjs | `general` |
| 121 | `scratch/test_search_api.mjs` | `file` | Test: test_search_api.mjs | `general` |
| 122 | `scratch/test_sources.mjs` | `file` | Test: test_sources.mjs | `general` |
| 123 | `scratch/test3.cjs` | `file` | Test: test3.cjs | `general` |
| 124 | `sea-config.json` | `config` | Configuration: sea-config.json | `config` |
| 125 | `sea-entry.cjs` | `file` | Source file: sea-entry.cjs | `general` |
| 126 | `serch.md` | `document` | Documentation: serch.md | `documentation` |
| 127 | `SINGLE IMPLEMENTATION + AUDIT + CROSS-CHECK PLAN.md` | `document` | Documentation: SINGLE IMPLEMENTATION + AUDIT + CROSS-CHECK PLAN.md | `documentation` |
| 128 | `SINGLE IMPLEMENTATION PLAN.MD` | `document` | Source file: SINGLE IMPLEMENTATION PLAN.MD | `documentation` |
| 129 | `SMALL_BUG_FIX_PLAN.md` | `document` | Documentation: SMALL_BUG_FIX_PLAN.md | `documentation` |
| 130 | `SPECIAL_ORDER_ARRIVAL_IMPLEMENTATION_PLAN.md` | `document` | Documentation: SPECIAL_ORDER_ARRIVAL_IMPLEMENTATION_PLAN.md | `documentation` |
| 131 | `src/AGENTS.md` | `document` | Documentation: AGENTS.md | `documentation` |
| 132 | `src/bootstrap.ts` | `file` | Source file: bootstrap.ts | `general` |
| 133 | `src/config/index.ts` | `file` | Source file: index.ts | `general` |
| 134 | `src/database.ts` | `file` | Source file: database.ts | `general` |
| 135 | `src/database/connection.ts` | `file` | Source file: connection.ts | `general` |
| 136 | `src/database/messageDAO.ts` | `file` | Source file: messageDAO.ts | `general` |
| 137 | `src/database/migrations/002_message_tables.sql` | `file` | SQL migration: 002_message_tables.sql | `migration` |
| 138 | `src/database/migrations/003_license_settings.sql` | `file` | SQL migration: 003_license_settings.sql | `migration` `auth` |
| 139 | `src/database/sqlitePatch.ts` | `file` | Source file: sqlitePatch.ts | `general` |
| 140 | `src/extractor.ts` | `file` | Source file: extractor.ts | `general` |
| 141 | `src/i18n/getMessage.ts` | `file` | Source file: getMessage.ts | `general` |
| 142 | `src/i18n/messages.json` | `config` | Configuration: messages.json | `config` |
| 143 | `src/process/processGuardian.ts` | `file` | Source file: processGuardian.ts | `general` |
| 144 | `src/server.ts` | `file` | Source file: server.ts | `general` |
| 145 | `src/telegramBot.ts` | `file` | Source file: telegramBot.ts | `telegram` |
| 146 | `src/utils/activityTracker.ts` | `file` | Source file: activityTracker.ts | `general` |
| 147 | `src/utils/auditEngine.ts` | `file` | Source file: auditEngine.ts | `general` |
| 148 | `src/utils/backgroundJobLane.ts` | `file` | Source file: backgroundJobLane.ts | `general` |
| 149 | `src/utils/chromeBrowser.ts` | `file` | Source file: chromeBrowser.ts | `general` |
| 150 | `src/utils/dateExtractor.ts` | `file` | Source file: dateExtractor.ts | `general` |
| 151 | `src/utils/distributorSyncHelper.ts` | `file` | Source file: distributorSyncHelper.ts | `general` |
| 152 | `src/utils/doctorUtils.ts` | `file` | Source file: doctorUtils.ts | `general` |
| 153 | `src/utils/drugSchedules.ts` | `file` | Source file: drugSchedules.ts | `general` |
| 154 | `src/utils/emailSanitizer.ts` | `file` | Source file: emailSanitizer.ts | `email` |
| 155 | `src/utils/inventoryActive.ts` | `file` | Source file: inventoryActive.ts | `general` |
| 156 | `src/utils/lazyPuppeteer.ts` | `file` | Source file: lazyPuppeteer.ts | `general` |
| 157 | `src/utils/logger.ts` | `file` | Source file: logger.ts | `general` |
| 158 | `src/utils/medicineSimilarityMatcher.ts` | `file` | Source file: medicineSimilarityMatcher.ts | `general` |
| 159 | `src/utils/migrationAudit.ts` | `file` | Source file: migrationAudit.ts | `migration` |
| 160 | `src/utils/migrationDistributorHelpers.ts` | `file` | Source file: migrationDistributorHelpers.ts | `migration` |
| 161 | `src/utils/migrationInventoryHelpers.ts` | `file` | Source file: migrationInventoryHelpers.ts | `migration` |
| 162 | `src/utils/migrationMeta.ts` | `file` | Source file: migrationMeta.ts | `migration` |
| 163 | `src/utils/migrationStockRebuild.ts` | `file` | Source file: migrationStockRebuild.ts | `migration` |
| 164 | `src/utils/migrationUtils.ts` | `file` | Source file: migrationUtils.ts | `migration` |
| 165 | `src/utils/migrationValidation.ts` | `file` | Source file: migrationValidation.ts | `migration` |
| 166 | `src/utils/mockGuard.ts` | `file` | Source file: mockGuard.ts | `general` |
| 167 | `src/utils/nameFormatter.ts` | `file` | Source file: nameFormatter.ts | `general` |
| 168 | `src/utils/nameNormalizer.ts` | `file` | Source file: nameNormalizer.ts | `general` |
| 169 | `src/utils/networkDetector.ts` | `file` | Source file: networkDetector.ts | `general` |
| 170 | `src/utils/notifications.ts` | `file` | Source file: notifications.ts | `general` |
| 171 | `src/utils/orderNameMatcher.ts` | `file` | Source file: orderNameMatcher.ts | `general` |
| 172 | `src/utils/packaging.ts` | `file` | Source file: packaging.ts | `general` |
| 173 | `src/utils/password.ts` | `file` | Source file: password.ts | `general` |
| 174 | `src/utils/pdfGenerator.ts` | `file` | Source file: pdfGenerator.ts | `general` |
| 175 | `src/utils/pharmacyCalendar.ts` | `file` | Source file: pharmacyCalendar.ts | `general` |
| 176 | `src/utils/preMigrationIntelligence.ts` | `file` | Source file: preMigrationIntelligence.ts | `general` |
| 177 | `src/utils/productNormalizer.ts` | `file` | Source file: productNormalizer.ts | `general` |
| 178 | `src/utils/reportCutover.ts` | `file` | Source file: reportCutover.ts | `general` |
| 179 | `src/utils/reportExporter.ts` | `file` | Source file: reportExporter.ts | `general` |
| 180 | `src/utils/retry.ts` | `file` | Source file: retry.ts | `general` |
| 181 | `src/utils/stockRebuild.ts` | `file` | Source file: stockRebuild.ts | `general` |
| 182 | `src/utils/validateStagingDatabase.ts` | `file` | Source file: validateStagingDatabase.ts | `general` |
| 183 | `src/utils/whatsappMediaDecryptor.ts` | `file` | Source file: whatsappMediaDecryptor.ts | `whatsapp` |
| 184 | `src/utils/whatsappTemplateBuilder.ts` | `file` | Source file: whatsappTemplateBuilder.ts | `whatsapp` |
| 185 | `src/whatsappClient.ts` | `file` | Source file: whatsappClient.ts | `whatsapp` |
| 186 | `stub-installer/main.js` | `file` | Source file: main.js | `general` |
| 187 | `stub-installer/package.json` | `config` | Configuration: package.json | `config` |
| 188 | `stub-installer/preload.js` | `file` | Source file: preload.js | `general` |
| 189 | `stub-installer/README.md` | `document` | Documentation: README.md | `documentation` |
| 190 | `stub-installer/renderer.html` | `file` | Source file: renderer.html | `general` |
| 191 | `stub-installer/renderer.js` | `file` | Source file: renderer.js | `general` |
| 192 | `Supplier Returns + Distributor-wise Sections + Dedicated Return History + Expiry/Add Batch Number to POS Sale Bill PDF Only.md` | `document` | Documentation: Add Batch Number to POS Sale Bill PDF Only.md | `documentation` |
| 193 | `Supplier Returns + Distributor-wise Sections + Dedicated Return History + Expiry/Return Sy.md` | `document` | Documentation: Return Sy.md | `documentation` |
| 194 | `The application currently risks treating WhatsApp OTP login.md` | `document` | Documentation: The application currently risks treating WhatsApp OTP login.md | `documentation` |
| 195 | `tools/migration-extractor/index.js` | `file` | Source file: index.js | `migration` |
| 196 | `tools/migration-extractor/package.json` | `config` | Configuration: package.json | `config` `migration` |
| 197 | `tools/migration-extractor/scripts/buildBundle.cjs` | `file` | Source file: buildBundle.cjs | `migration` |
| 198 | `tools/migration-extractor/scripts/buildSea.cjs` | `file` | Source file: buildSea.cjs | `migration` |
| 199 | `tools/migration-extractor/sea-config.json` | `config` | Configuration: sea-config.json | `config` `migration` |
| 200 | `trigger_reload.mjs` | `file` | Source file: trigger_reload.mjs | `general` |
| 201 | `tsconfig.json` | `config` | Configuration: tsconfig.json | `config` |
| 202 | `UNIFIED WHATSAPP BOT AUTO-WORK IMPLEMENTATION PLAN.md` | `document` | Documentation: UNIFIED WHATSAPP BOT AUTO-WORK IMPLEMENTATION PLAN.md | `documentation` |
| 203 | `UNIFIED_BOT_AUTO_WORK_SCHEDULE_PAYMENT_IMPLEMENTATION_PLAN.md` | `document` | Documentation: UNIFIED_BOT_AUTO_WORK_SCHEDULE_PAYMENT_IMPLEMENTATION_PLAN.md | `documentation` |
| 204 | `vercel.json` | `config` | Configuration: vercel.json | `config` |
| 205 | `WEBSITE ORDER + REFILL → EXISTING PHARMACY ORDER WORKFLOW.md` | `document` | Documentation: WEBSITE ORDER + REFILL → EXISTING PHARMACY ORDER WORKFLOW.md | `documentation` |
| 206 | `website/api/_db.js` | `file` | Source file: _db.js | `general` |
| 207 | `website/api/catalog.js` | `file` | Source file: catalog.js | `general` |
| 208 | `website/api/license.js` | `file` | Source file: license.js | `auth` |
| 209 | `website/api/telemetry.js` | `file` | Source file: telemetry.js | `general` |
| 210 | `website/api/updates.js` | `file` | Source file: updates.js | `general` |
| 211 | `website/package.json` | `config` | Configuration: package.json | `config` |
| 212 | `website/public/catalog.html` | `file` | Source file: catalog.html | `general` |
| 213 | `website/public/index.html` | `file` | Source file: index.html | `general` |
| 214 | `website/public/portal.html` | `file` | Source file: portal.html | `general` |
| 215 | `website/README.md` | `document` | Documentation: README.md | `documentation` |
| 216 | `website/vercel.json` | `config` | Configuration: vercel.json | `config` |
| 217 | `WhatsApp Confirmed Order.md` | `document` | Documentation: WhatsApp Confirmed Order.md | `documentation` |
| 218 | `WhatsApp Medicine Request → Ph.md` | `document` | Documentation: WhatsApp Medicine Request → Ph.md | `documentation` |
| 219 | `WHATSAPP_QUEUE_AND_HEADER_CLEANUP_PLAN.md` | `document` | Documentation: WHATSAPP_QUEUE_AND_HEADER_CLEANUP_PLAN.md | `documentation` |
| 220 | `WHATSAPP_REFILL_ENQUIRY_IMPLEMENTATION_PLAN.md` | `document` | Documentation: WHATSAPP_REFILL_ENQUIRY_IMPLEMENTATION_PLAN.md | `documentation` |

## Node Type Breakdown

| Type | Count | Example |
|---|---|---|
| `file` | 700 | `bootstrapper/main.ts` |
| `test` | 115 | `tests/aiCamera.test.ts` |
| `service` | 92 | `src/services/activityTracker.ts` |
| `document` | 88 | `.agents/rules/bug-fix.md` |
| `config` | 33 | `.vscode/settings.json` |

## Dependency Graph (imports)

Edges represent `import`/`require` relationships detected in source (resolve-based, first 50 lines). Only edges whose source and target exist as documented nodes are shown.

### Most Imported Modules (top 30 dependents)

| Imported By Count | Module |
|---|---|
| 67 | `frontend/src/services/api.ts` |
| 38 | `frontend/src/services/events.ts` |
| 29 | `frontend/src/services/keyboardShortcuts.ts` |
| 27 | `pharmacy-mobile/lib/theme.ts` |
| 23 | `frontend/src/utils/date.ts` |
| 23 | `frontend/src/hooks/useApiQuery.ts` |
| 18 | `pharmacy-mobile/lib/api.ts` |
| 13 | `pharmacy-mobile/lib/api/client.ts` |
| 12 | `frontend/src/utils/cacheInvalidation.ts` |
| 12 | `frontend/src/lib/keepAlive/PageActiveContext.tsx` |
| 9 | `pharmacy-mobile/lib/secureStore.ts` |
| 8 | `frontend/src/hooks/usePersistedDateRange.ts` |
| 8 | `frontend/src/utils/phone.ts` |
| 7 | `frontend/src/hooks/useInfiniteScroll.ts` |
| 6 | `frontend/src/utils/settingsSync.ts` |
| 6 | `frontend/src/components/InfiniteScrollStatus.tsx` |
| 6 | `frontend/src/utils/export.ts` |
| 5 | `frontend/src/hooks/useVirtualizer.ts` |
| 5 | `frontend/src/components/InfiniteTable.tsx` |
| 5 | `frontend/src/components/VirtualRow.tsx` |
| 5 | `frontend/src/components/UniversalMedicineEditModal.tsx` |
| 5 | `frontend/src/components/PhoneInputWithBadge.tsx` |
| 5 | `frontend/src/context/StoreContext.tsx` |
| 5 | `website/api/_db.js` |
| 5 | `frontend/src/hooks/useWaPhoneStatus.ts` |
| 4 | `frontend/src/hooks/useOnClickOutside.ts` |
| 4 | `frontend/src/hooks/useDeferredEffect.ts` |
| 4 | `frontend/src/utils/packagingMatcher.ts` |
| 4 | `frontend/src/utils/currency.ts` |
| 4 | `pharmacy-mobile/lib/api/inventory.ts` |

### Most Dependent Sources (top 20 importing modules)

| Imports | Module |
|---|---|
| 20 | `frontend/src/pages/POS/index.tsx` |
| 18 | `frontend/src/pages/Purchases/index.tsx` |
| 15 | `frontend/src/pages/Inventory/index.tsx` |
| 15 | `frontend/src/pages/Sells/index.tsx` |
| 14 | `frontend/src/pages/CRM/index.tsx` |
| 14 | `frontend/src/pages/Settings/index.tsx` |
| 14 | `pharmacy-mobile/lib/api.ts` |
| 12 | `frontend/src/pages/PurchaseHistory/index.tsx` |
| 12 | `frontend/src/pages/Returns/index.tsx` |
| 11 | `frontend/src/pages/Investigation/index.tsx` |
| 10 | `frontend/src/pages/PharmarackCart/index.tsx` |
| 10 | `frontend/src/pages/Learning/index.tsx` |
| 9 | `frontend/src/App.tsx` |
| 9 | `frontend/src/pages/CustomerReturnHistory/index.tsx` |
| 9 | `frontend/src/pages/Database/index.tsx` |
| 9 | `frontend/src/pages/Dispatch/index.tsx` |
| 8 | `pharmacy-mobile/lib/api/sync.ts` |
| 7 | `frontend/src/pages/Mail/index.tsx` |
| 6 | `frontend/src/components/QuickOrderModal.tsx` |
| 6 | `frontend/src/pages/Expiry/index.tsx` |

## Automation and Background Timers

Services and workers that scan files for repeated-interval, cron, or background-loop behaviour. Intervals are summarized from the file inventory; confirm exact values in source.

| Service | Path |
|---|---|
| backupRecoveryService.ts | `src/services/backupRecoveryService.ts` |
| backupService.ts | `src/services/backupService.ts` |
| bouncedAlertService.ts | `src/services/bouncedAlertService.ts` |
| cloudCatalogSyncService.ts | `src/services/cloudCatalogSyncService.ts` |
| creditReminderService.ts | `src/services/creditReminderService.ts` |
| distributorDispatchReminderWorker.ts | `src/services/distributorDispatchReminderWorker.ts` |
| expiryAlertService.ts | `src/services/expiryAlertService.ts` |
| messagingQueue.ts | `src/services/messagingQueue.ts` |
| ocrScanQueue.ts | `src/services/ocrScanQueue.ts` |
| pharmarackDailyDispatchService.ts | `src/services/pharmarackDailyDispatchService.ts` |
| prescriptionScannerService.ts | `src/services/prescriptionScannerService.ts` |
| scheduleResearchService.ts | `src/services/scheduleResearchService.ts` |
| shortageReminderService.ts | `src/services/shortageReminderService.ts` |
| startupSyncCoordinator.ts | `src/services/startupSyncCoordinator.ts` |
| storeSyncService.ts | `src/services/storeSyncService.ts` |
| tokenRefreshScheduler.ts | `src/services/tokenRefreshScheduler.ts` |
| triggerSchedulerService.ts | `src/services/triggerSchedulerService.ts` |
| whatsappQueue.ts | `src/services/whatsappQueue.ts` |
| whatsappQueueWorker.ts | `src/services/whatsappQueueWorker.ts` |

## Configuration & Environment

| Type | Count |
|---|---|
| Config nodes (json/yml/env) | 33 |

| Env file | Description |
|---|---|
| `packaging/portable.env` | Source file: portable.env |

## Generated Notes

- Graph totals include vendored packages (`.venv`, `node_modules`, caches) that are excluded from the narrative sections.
- Edges shown are only those whose both endpoints survived the noise filter; the raw graph may carry more edges.
- Regenerate with:
  ```bash
  node scripts/quick-update.mjs          # refresh the graph
  node scripts/generate-project-docs.mjs # refresh this document
  ```

---
_Generated at 2026-09-22T16:46:13.393Z._