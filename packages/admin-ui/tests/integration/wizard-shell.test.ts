import { describe, expect, it } from "vitest";

import { renderWizardShell } from "../../src/pages";

describe("wizard-shell", () => {
  it("renders step navigation and required form input", () => {
    const root = document.createElement("div");
    renderWizardShell(root, { currentStep: 2, totalSteps: 5 });

    expect(root.textContent).toContain("Step 2/5");
    const requiredInput = root.querySelector("[data-testid='wizard-required-input']") as HTMLInputElement;
    expect(requiredInput.required).toBe(true);
  });
});
