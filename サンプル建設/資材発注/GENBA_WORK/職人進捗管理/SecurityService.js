/**
 * Handles lightweight security such as passcode validation.
 */
const SecurityService = (() => {
  const validatePasscode = passcode => {
    if (UtilitiesEx.isBlank(passcode)) {
      return false;
    }
    const settings = SheetRepository.getSettingsMap();
    const stored = settings[APP_CONFIG.settingsKeys.passcode];
    if (UtilitiesEx.isBlank(stored)) {
      return false;
    }
    return String(stored).trim() === String(passcode).trim();
  };

  return {
    validatePasscode
  };
})();
