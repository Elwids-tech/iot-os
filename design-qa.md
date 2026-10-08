# Native device onboarding — design QA

**Source visual truth:** `/Users/tharindarodrigo/.codex/generated_images/01a11420-c3f1-7450-a1ce-848eaebf299e/exec-9394dd20-9867-4f9a-8978-350d305457aa.png` (selected option 3).

**Implementation:** local portal `/organizations/08b842d4-dbe9-44b7-a82f-8409bf31401a/devices/onboard` and the Workshop water meter setup. Screenshots are under `.local/onboarding-audit/implementation/`.

**Comparison evidence:** `.local/onboarding-audit/comparison.png` places the selected first-step and review panels beside browser captures `01-device-fixed.png` and `05-ready.png`. Source board: 1487 × 1058 pixels. First-step capture: 1640 × 1331; completion: 1280 × 720. The comparison crops the source panels and lower blank space in the wide first-step capture, then proportionally scales each into its comparison cell. It is a composition comparison, not a pixel-perfect comparison between identical viewports. Review versus activated states intentionally differ. Original captures retain full detail for control/text inspection.

## Findings and resolutions

- The earlier solid-blue selected connection option made secondary copy hard to read. Replaced it with the shared radio-group and field cards. `01-device-fixed.png` confirms a pale selection, visible radio indicator, and readable supporting text.
- The connected state previously retained waiting/troubleshooting copy. It now displays a connected heading and measurement-matching guidance. Rebuilt portal/admin before verifying the completed workflow.
- Long floating-point volume samples distracted from the measurement. The wizard now displays up to three decimal places, while stored numeric precision is unchanged.

## Fidelity surfaces

- Typography: existing portal font and shared hierarchy retained; 24px onboarding headings and readable body/helper text. No new display font. The mock is a generated concept, so the implementation follows the existing product's typography rather than its raster glyphs.
- Spacing/layout: main task area plus contextual right rail, step indicator, save/exit, and one primary next action preserve the chosen structure. The live app retains its existing sidebar and wider desktop frame. Narrow screens stack content and help; the checked mobile DOM had no horizontal overflow (document width 341, viewport 355 CSS pixels; requested browser override 390 × 844). The override was reset.
- Colors/tokens: shared portal background, primary blue, subtle dividers, pale selection, and semantic status colors. Shared status marks are used instead of the concept's decorative green circles. This is an intentional consistency choice.
- Assets: this flow needs no product photography. Native shared Lucide icons and UI controls replace generated icon approximations; no mock screenshot is embedded as UI.
- Copy/content: water-meter units and names replace temperature/humidity examples. TLS authentication, public CA, local hostname limits, preview versus storage, retry, and resume are explicit. Completion is only shown after runtime acknowledgement and persisted readings.

## Verification

Browser-tested ZIP download, saved setup and resume, discovery, both metric mappings, validation, activation, completion, live Measurements, and simulator reconnect. API checks cover tenant isolation, permissions, idempotency, gateway credential isolation, provisioning retry, and CA/ZIP behavior. Desktop and narrow-screen captures are saved; browser warning/error logs were empty. Full dark-theme and physical-hardware testing were not performed.

The combined comparison and original control captures show no remaining actionable P0/P1/P2 findings. Existing shared-shell density and token differences are accepted product constraints. Optional P3 refinement: add a compact visual connection diagram in help for first-time users.

**Implementation checklist:** completed layout/state fixes; rebuilt affected containers; verified browser completion and stored water-meter readings; retained private recovery evidence.

**Final result:** passed
