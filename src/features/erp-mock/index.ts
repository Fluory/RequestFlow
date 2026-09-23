// Public API of the `erp-mock` module: simulated ERP REST API (behind ERP_MOCK_ENABLED).
// Other modules import only from this file (dependency-cruiser, ADR-0001 D1).
export { createErpMock, MemoryMockStore, parseFaults, type ErpMock, type ErpMockOptions, type MockFault, type MockRecord, type MockStore } from "./mock";
