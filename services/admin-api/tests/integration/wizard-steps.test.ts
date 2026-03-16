import { describe, expect, it, vi } from "vitest";

import { AdminApiService } from "../../src/index";

function makeService() {
  return new AdminApiService({
    secretStore: {
      write: vi.fn(async () => undefined),
      read: vi.fn(async () => null)
    }
  });
}

describe("wizard-steps", () => {
  it("enforces step order and rejects duplicate submissions", () => {
    const service = makeService();
    expect(service.getWizardStep("org-1")).toBe(1);
    expect(service.submitWizardStep("org-1", 1)).toBe(2);
    expect(() => service.submitWizardStep("org-1", 1)).toThrowError("wizard step out of order");
  });

  it("caps wizard step at 5", () => {
    const service = makeService();
    expect(service.submitWizardStep("org-1", 1)).toBe(2);
    expect(service.submitWizardStep("org-1", 2)).toBe(3);
    expect(service.submitWizardStep("org-1", 3)).toBe(4);
    expect(service.submitWizardStep("org-1", 4)).toBe(5);
    expect(service.submitWizardStep("org-1", 5)).toBe(5);
    expect(service.getWizardStep("org-1")).toBe(5);
  });
});
