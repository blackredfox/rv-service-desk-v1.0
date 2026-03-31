export const RVSD_CONTRACT_FIXTURES = {
  diagnosticValid: `System: Water heater
Classification: Consumer appliance
Status: Isolation not completed; Cause cannot be formed

Step 5: Is 12V DC present at the control board?`,

  diagnosticFinalReportDrift: `Complaint: Water heater will not ignite.
Diagnostic Procedure: Verified 12V supply and gas availability.
Verified Condition: Ignition board does not respond.
Recommended Corrective Action: Replace ignition board.
Estimated Labor: Total labor: 1.0 hr.
Required Parts: Ignition board.`,

  diagnosticPrematureCompletion: `Isolation complete. Conditions met. Transitioning to Final Report Mode.`,

  finalReportValid: `Complaint: Water heater ignition fault.
Diagnostic Procedure: Verified 12V supply and checked the control-board fuse.
Verified Condition: Fuse continuity loss identified in the 12V supply path.
Recommended Corrective Action: Replace the fuse and verify heater operation.
Estimated Labor: Access and fuse replacement - 0.4 hr. Total labor: 0.4 hr.
Required Parts: Fuse.
--- TRANSLATION ---
Жалоба: Неисправность розжига водонагревателя.
Диагностическая процедура: Проверено питание 12V и осмотрен предохранитель платы управления.
Подтверждённое состояние: В цепи питания 12V выявлена потеря проводимости предохранителя.
Рекомендованное корректирующее действие: Заменить предохранитель и проверить работу водонагревателя.
Оценка трудоёмкости: Доступ и замена предохранителя - 0.4 ч. Общее время: 0.4 ч.
Требуемые детали: Предохранитель.`,

  finalReportMissingHeader: `Complaint: Water heater ignition fault.
Diagnostic Procedure: Verified 12V supply and checked the control-board fuse.
Verified Condition: Fuse continuity loss identified in the 12V supply path.
Recommended Corrective Action: Replace the fuse and verify heater operation.
Estimated Labor: Access and fuse replacement - 0.4 hr. Total labor: 0.4 hr.
--- TRANSLATION ---
Жалоба: Неисправность розжига водонагревателя.`,

  finalReportLanguageMismatch: `Complaint: Water heater ignition fault.
Diagnostic Procedure: Verified 12V supply and checked the control-board fuse.
Verified Condition: Fuse continuity loss identified in the 12V supply path.
Recommended Corrective Action: Replace the fuse and verify heater operation.
Estimated Labor: Access and fuse replacement - 0.4 hr. Total labor: 0.4 hr.
Required Parts: Fuse.
--- TRANSLATION ---
Complaint: Water heater ignition fault.
Diagnostic Procedure: Verified 12V supply and checked the control-board fuse.`,

  authorizationDrift: `Complaint: Water heater will not ignite.
Diagnostic Procedure: Verified 12V supply.
Verified Condition: Heater remains inoperative.
Recommended Corrective Action: Replace ignition board.`,

  transitionDoctrineNegative: `Isolation complete. Conditions met. Ready to transition to Final Report Mode.`,
} as const;