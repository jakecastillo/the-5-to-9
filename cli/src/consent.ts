// The hardened consent contract now lives in the driver package so the
// orchestrator (driver) and the CLI/TUI share ONE implementation (Phase 1c).
// `cli` depends on `driver`, so the import direction is correct; re-importing
// from here would be circular and re-implementing it would duplicate the F1–F4
// security logic. This 1-line re-export shim keeps every existing CLI importer
// working unchanged while the source of truth is `@the-5-to-9/driver`.
export * from '@the-5-to-9/driver/src/consent.ts';
