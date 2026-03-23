export function isDuplicateApproval(seen: boolean, inFlight: boolean): boolean {
  return seen || inFlight;
}

export function mapBridgeDecisionResult(result: "resolved" | "duplicate" | void): "applied" | "bridge_duplicate" {
  return result === "duplicate" ? "bridge_duplicate" : "applied";
}
