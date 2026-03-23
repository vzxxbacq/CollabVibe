/**
 * Barrel export for IM channel contracts (formerly packages/channel-core).
 * This is the unified entry point for all IM output/input/event types.
 */
export * from "./channel-adapter";
export * from "./errors";
export * from "./intent-router";
export * from "./im-output";
export * from "./event-transformer";
export * from "./turn-state";
export * from "./turn-context";
export * from "./stream-aggregator";
export * from "./types";
export * from "./unified-message";
export * from "./app-locale";
export * from "./platform-input";
export * from "./platform-action";
export * from "./platform-output";
export * from "./input-parser";
export * from "./merge-naming";
export { MAIN_THREAD_NAME } from "../../../packages/agent-core/src/constants";
