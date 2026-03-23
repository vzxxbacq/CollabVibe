import { TurnState } from "./turn-state";

/**
 * Backward-compatible alias.
 * New code should depend on TurnState directly.
 */
export class TurnContext extends TurnState {}
