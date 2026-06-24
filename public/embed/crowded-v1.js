/**
 * DonorHQ × Crowded — embed loader v1
 *
 * Usage (one line, anywhere on a third-party page):
 *
 *   <script src="https://donorhq.givesuite.com/embed/crowded-v1.js"
 *           data-form="123" data-text="Donate Now" async></script>
 *
 * What it does:
 *   1. Reads `data-form` (donate page id) and `data-text` (button label)
 *      off its own <script> tag.
 *   2. Inserts a styled <button> at the script's location.
 *   3. On click: opens an iframe of /donate/<formId> in a centred modal
 *      overlay. ESC + click-outside + the X icon all close it.
 *
 * No frameworks. ~5 KB unminified. Lives in /public/ so it's served at a
 * stable URL across deploys.
 */
(function () {
  "use strict";

  // Self-resolve the script's origin so we don't need to hardcode it.
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();
  if (!currentScript) return;

  var formId = currentScript.getAttribute("data-form");
  var labelText = currentScript.getAttribute("data-text") || "Donate";
  if (!formId) {
    console.warn("[crowded-embed] data-form is required");
    return;
  }

  var origin = (function () {
    try {
      return new URL(currentScript.src).origin;
    } catch (e) {
      return "";
    }
  })();
  var donateUrl = origin + "/donate/" + encodeURIComponent(formId);

  // ── Inject the button ─────────────────────────────────────────────────
  var btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = labelText;
  btn.setAttribute(
    "style",
    [
      "background:#00A99D",
      "color:#ffffff",
      "border:0",
      "border-radius:12px",
      "padding:13px 22px",
      "font-size:15px",
      "font-weight:600",
      "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
      "cursor:pointer",
      "box-shadow:0 8px 22px rgba(0,169,157,0.30)",
      "transition:transform 80ms ease, box-shadow 120ms ease",
      "display:inline-block",
    ].join(";")
  );
  btn.addEventListener("mouseenter", function () {
    btn.style.transform = "translateY(-1px)";
    btn.style.boxShadow = "0 12px 28px rgba(0,169,157,0.40)";
  });
  btn.addEventListener("mouseleave", function () {
    btn.style.transform = "translateY(0)";
    btn.style.boxShadow = "0 8px 22px rgba(0,169,157,0.30)";
  });
  currentScript.parentNode.insertBefore(btn, currentScript);

  // ── Modal infrastructure ──────────────────────────────────────────────
  var overlay = null;

  function openModal() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute(
      "style",
      [
        "position:fixed",
        "inset:0",
        "background:rgba(15,42,46,0.55)",
        "z-index:2147483647", // top of stack
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:24px",
        "animation:crwdFadeIn 160ms ease-out",
      ].join(";")
    );

    // Inject keyframes once.
    if (!document.getElementById("crwd-anim-style")) {
      var style = document.createElement("style");
      style.id = "crwd-anim-style";
      style.textContent =
        "@keyframes crwdFadeIn{from{opacity:0}to{opacity:1}}" +
        "@keyframes crwdSlideUp{from{transform:translateY(20px);opacity:0}" +
        "to{transform:translateY(0);opacity:1}}";
      document.head.appendChild(style);
    }

    var card = document.createElement("div");
    card.setAttribute(
      "style",
      [
        "position:relative",
        "background:#fff",
        "border-radius:20px",
        "width:100%",
        "max-width:680px",
        "height:90vh",
        "max-height:980px",
        "overflow:hidden",
        "box-shadow:0 30px 80px rgba(15,42,46,0.40)",
        "animation:crwdSlideUp 220ms ease-out",
      ].join(";")
    );

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "&times;";
    closeBtn.setAttribute(
      "style",
      [
        "position:absolute",
        "top:14px",
        "right:14px",
        "z-index:1",
        "border:0",
        "background:rgba(15,42,46,0.06)",
        "color:#0F2A2E",
        "width:36px",
        "height:36px",
        "border-radius:50%",
        "font-size:22px",
        "line-height:1",
        "cursor:pointer",
        "font-family:system-ui,sans-serif",
      ].join(";")
    );
    closeBtn.addEventListener("click", closeModal);

    var iframe = document.createElement("iframe");
    iframe.src = donateUrl;
    iframe.setAttribute("allow", "payment");
    iframe.setAttribute("title", labelText);
    iframe.setAttribute(
      "style",
      "width:100%;height:100%;border:0;display:block;background:transparent"
    );

    card.appendChild(closeBtn);
    card.appendChild(iframe);
    overlay.appendChild(card);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
  }

  function closeModal() {
    if (!overlay) return;
    document.removeEventListener("keydown", onEsc);
    document.body.style.overflow = "";
    overlay.parentNode && overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  function onEsc(e) {
    if (e.key === "Escape") closeModal();
  }

  btn.addEventListener("click", openModal);
})();
