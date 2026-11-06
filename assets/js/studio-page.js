(async function () {
  try { await window.VC.Studio.page(); }
  catch (error) { window.VC.fail(error,"Impossible de charger Studio."); }
})();
