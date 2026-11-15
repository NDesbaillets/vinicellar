// Vinicellar · socle partagé par toutes les pages connectées :
// client Supabase, contrôle de session, navigation, icônes, formats, fiche (formulaire), étoiles, toasts.
(function () {
  // Lien reçu par e-mail (invitation, création de compte, mot de passe oublié) ouvert sur une autre page :
  // on l'oriente vers la bonne page AVANT que supabase-js ne consomme le jeton.
  const h = location.hash;
  if (/type=(invite|recovery|signup|magiclink)|error_code=/.test(h)) {
    const recovery = /type=recovery/.test(h) || (/error_code=/.test(h) && /mot-de-passe/.test(location.pathname));
    const target = recovery ? "/nouveau-mot-de-passe.html" : "/bienvenue.html";
    if (location.pathname !== target) { location.replace(target + h); return; }
  }

  const cfg = window.VC_CONFIG || {};
  const sb = window.supabase && cfg.supabaseUrl
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : null;

  // Préférence locale : aucun changement de profil ou de données serveur.
  // Fond derrière les aperçus de bouteille (images transparentes) : blanc, ivoire ou aucun. Réglage de l'appareil.
  const VISUAL_BG = ["white", "ivory", "none"];
  const getVisualBg = () => { try { const v = localStorage.getItem("vc.visual-bg"); return VISUAL_BG.includes(v) ? v : "white"; } catch { return "white"; } };
  const setVisualBg = (v) => { try { localStorage.setItem("vc.visual-bg", v); } catch { /* stockage indisponible */ } document.documentElement.dataset.visualBg = v; };
  document.documentElement.dataset.visualBg = getVisualBg();
  let theme = "system";
  try { theme = localStorage.getItem("vc.theme") || "system"; } catch { /* stockage indisponible */ }
  if (!["system", "light", "dark"].includes(theme)) theme = "system";
  const applyTheme = () => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => {
      const label = { system: "Système", light: "Clair", dark: "Sombre" }[theme];
      b.setAttribute("aria-label", `Thème : ${label}. Changer de thème`);
      b.title = `Thème : ${label}`;
      b.textContent = { system: "◐", light: "☀", dark: "☾" }[theme];
    });
  };
  applyTheme();
  document.addEventListener("DOMContentLoaded", applyTheme, { once: true });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-toggle]")) return;
    theme = { system: "light", light: "dark", dark: "system" }[theme];
    try { localStorage.setItem("vc.theme", theme); } catch { /* préférence pour cette session */ }
    applyTheme();
  });

  // ------------------------------------------------------------------ icônes (traits 1.6, 24×24)
  const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    logo: `<svg class="logo" viewBox="314 295 453 858" fill="currentColor" aria-hidden="true"><path d="M549.75,304.902C566.001,305.07 582.248,305.378 598.5,305.327C599.669,305.324 600.833,305.458 602,305.51C608.166,305.786 614.332,305.977 620.5,306.191C623.836,306.307 627.181,306.174 630.5,306.521C635.907,307.087 641.374,306.83 646.749,307.369C651.049,307.799 655.192,308.054 659.499,308.234C661.597,308.323 663.656,308.846 665.75,309.003C670.031,309.323 671.829,309.325 676.249,310.167C676.253,310.168 676.805,310.293 676.808,310.294C684.324,312.443 687.525,320.091 690.518,326.504C695.792,337.803 700.768,349.229 705.605,360.723C707.976,366.358 710.579,371.912 712.799,377.611C714.356,381.609 716.233,385.494 717.746,389.492C719.992,395.429 722.082,401.382 724.526,407.248C725.37,409.274 725.805,411.446 726.588,413.497C732.337,428.559 736.815,444.108 741.585,459.496C743.793,466.62 744.672,473.135 746.423,479.998C749.012,490.146 750.633,500.47 752.527,510.749C753.897,518.183 754.39,525.733 755.202,533.249C756.292,543.352 757.384,561.754 756.295,573.748C754.855,589.621 753.575,605.622 749.242,620.961C747.068,628.656 745.143,636.44 742.32,643.922C738.195,654.852 729.199,677.025 722.558,688.278C718.028,695.955 713.355,703.541 708.669,711.123C707.501,713.011 706.035,714.696 704.756,716.51C701.606,720.984 698.278,725.165 694.922,729.481C691.577,733.782 686.389,739.106 682.966,742.741C682.963,742.744 682.151,743.636 682.149,743.639C677.219,749.167 671.838,753.889 666.474,758.969C660.611,764.523 654.453,769.555 647.821,774.185C641.461,778.626 635.123,783.473 628.306,787.194C623.205,789.979 618.229,792.995 613,795.529C608.637,797.644 590.187,805.685 585.396,809.368C576.93,815.878 570.735,821.845 565.652,831.297C556.938,847.503 556.211,869.969 555.942,888C555.922,889.333 555.928,890.667 555.937,892C556.053,908.169 555.786,924.333 555.9,940.5C556.065,963.912 555.722,987.34 555.993,1010.75C556.141,1023.5 555.825,1036.26 556.039,1049C556.165,1056.47 556.892,1063.96 558.677,1071.22C559.93,1076.31 564.789,1086.7 568.505,1090.5C582.221,1104.51 592.15,1107.68 612.746,1112.03C618.572,1113.26 630.144,1115.14 637.249,1115.85C637.253,1115.85 638.246,1115.96 638.25,1115.96C650.316,1117.25 662.431,1117.77 674.502,1119.02C676.036,1119.17 677.459,1119.35 679,1119.62C684.326,1120.56 693.404,1124.3 692.426,1131.25C691.19,1140.03 681.184,1141.56 674,1141.73C668.085,1141.87 662.165,1142.01 656.25,1142.09C641.015,1142.31 625.735,1142.6 610.5,1142.59C594.75,1142.58 578.996,1142.88 563.25,1142.84C556.088,1142.82 548.908,1142.94 541.75,1142.88C529.009,1142.76 516.241,1142.66 503.5,1142.69C473.02,1142.77 442.47,1142.23 412,1141.53C405.997,1141.39 394.116,1140.71 392.457,1133C389.875,1121 406.088,1119.51 414.05,1118.73C423.186,1117.82 432.354,1117.34 441.5,1116.53C448.623,1115.9 455.684,1114.73 462.756,1113.68C469.243,1112.71 481.918,1110.05 487.957,1107.84C492.172,1106.3 496.386,1104.74 500.402,1102.73C505.292,1100.29 515.354,1091.97 518.208,1087.37C519.303,1085.6 520.339,1083.79 521.39,1082C525.841,1074.39 527.732,1061.4 527.912,1052.75C527.998,1048.6 528.476,1044.39 528.371,1040.25C528.206,1033.74 528.235,1027.26 528.362,1020.75C528.409,1018.34 528.135,1015.92 528.24,1013.51C528.37,1010.54 528.116,1007.7 528.086,1004.75C528.015,997.701 527.957,990.55 528.249,983.505C528.712,972.333 527.883,961.159 528.186,950C528.46,939.906 528.04,929.842 528.114,919.75C528.223,904.9 527.932,890.094 527.717,875.25C527.548,863.567 526.337,855.435 523.609,844.248C522.797,840.918 521.517,838.016 520.211,834.878C514.331,820.749 502.288,810.274 488.473,804.144C475.204,798.256 466.514,794.019 453.753,787.005C449.55,784.694 445.643,781.892 441.562,779.371C439.304,777.976 427.815,769.788 426.419,768.604C417.5,761.043 408.541,753.483 400.667,744.839C400.332,744.472 393.921,738.178 392.966,736.996C384.765,726.844 376.27,716.879 369.398,705.783C365.033,698.736 360.146,691.941 356.469,684.496C351.252,673.93 346.147,664.694 341.932,653.249C338.373,643.585 334.879,633.53 332.49,623.502C332.489,623.498 332.313,622.793 332.312,622.789C329.397,611.533 326.486,598.122 325.574,586.499C324.939,578.421 324.558,570.334 324.009,562.25C323.942,561.251 324.016,560.248 324.096,559.25C324.605,552.928 324.261,546.563 324.871,540.25C324.871,540.246 324.934,539.503 324.934,539.499C326.681,514.916 331.484,490.665 337.437,466.75C343.251,443.391 349.518,425.301 357.756,402.423C359.378,397.917 361.47,393.599 363.198,389.131C365.006,384.456 366.837,379.795 368.715,375.147C368.717,375.144 368.994,374.507 368.995,374.504C373.677,364.132 378.004,352.833 383.197,342.803C385.98,337.429 388.278,331.893 390.847,326.426C390.848,326.422 391.563,325.003 391.565,325C394.358,319.64 396.811,314.241 402.508,311.547C405.103,310.321 412.138,309.398 415,309.21C419.183,308.936 423.309,308.258 427.5,308.187C430.002,308.144 432.515,308.265 434.999,307.971C437.829,307.635 440.65,307.148 443.5,307.171C450.202,307.225 456.819,306.302 463.5,306.229C474.522,306.11 485.486,305.731 496.5,305.269C498.499,305.185 500.499,305.352 502.5,305.334C509.165,305.277 515.833,305.175 522.5,305.154C531.572,305.124 540.682,304.808 549.75,304.902ZM671.792,326.036C669.469,325.544 667.12,325.169 664.751,325.027C652.493,324.295 640.288,323.268 628.001,322.877C622.418,322.7 616.832,322.427 611.25,322.208C611.246,322.208 609.754,322.159 609.75,322.159C587.839,321.559 565.919,321.437 544,321.371C543.996,321.371 540.004,321.372 540,321.372C515.579,321.453 491.162,321.815 466.75,322.5C452.739,322.892 438.731,323.454 424.75,324.463C419.933,324.811 414.358,325.328 409.816,326.033C407.121,329.958 405.488,334.623 403.312,338.865C401.65,342.105 400.03,345.442 398.514,348.755C387.707,372.384 377.918,396.458 368.768,420.777C364.146,433.06 360.551,445.911 356.851,458.499C355.075,464.54 353.601,470.645 352.148,476.761C351.316,480.261 350.26,483.712 349.624,487.252C347.771,497.571 345.96,507.891 344.347,518.25C344.347,518.253 344.165,519.499 344.164,519.503C342.359,534.486 341.648,543.006 341.344,558.25C341.214,564.767 341.736,571.245 341.912,577.75C342.007,581.26 342.827,584.71 342.979,588.249C343.063,590.191 343.905,594.724 344.299,596.789C344.948,600.19 345.548,603.589 346.143,606.994C346.144,606.997 346.257,607.546 346.257,607.55C347.653,613.553 348.614,619.678 350.644,625.498C354.532,636.646 357.698,648.758 362.925,659.493C365.443,664.663 367.607,670.014 370.479,674.995C372.479,678.464 377.174,687.559 379.708,691.106C383.695,696.688 387.43,702.435 391.446,707.997C392.205,709.049 393.17,709.94 393.912,711.005C397.071,715.539 400.77,719.644 404.294,723.902C409.613,730.329 424.155,744.682 431.24,750.254C435.531,753.629 439.875,756.921 444.114,760.36C446.84,762.571 453.907,766.953 456.031,768.391C459.778,770.929 472.643,777.735 477.679,779.773C489.274,784.465 493.339,786.244 504.274,789.364C509.917,790.974 526.144,793.879 532.999,794.057C537.879,794.183 542.61,794.269 547.5,794.096C548.25,794.07 549,794.069 549.75,794.074C552.752,794.092 564.395,792.736 567.248,792.043C570.849,791.168 574.425,790.449 578,789.485C582.809,788.188 587.576,786.77 592.298,785.188C599.117,782.904 614.338,774.957 619.329,772.284C629.057,767.073 638.301,759.809 646.894,753.34C648.573,752.076 649.974,750.666 651.697,749.427C653.132,748.395 654.224,747 655.698,745.919C660.16,742.647 663.274,737.871 667.431,734.222C674.74,727.807 678.945,722.006 685.411,714.441C689.585,709.557 695.369,700.717 698.452,695.504C700.433,692.154 702.76,689.022 704.679,685.637C709.627,676.905 717.85,661.294 721.671,650.291C722.487,647.943 723.711,645.422 724.707,643.146C727.65,636.426 729.32,628.767 731.318,621.712C735.094,608.38 737.281,594.542 738.454,580.75C738.897,575.544 739.85,561.132 739.449,555.5C738.729,545.405 738.654,535.269 737.081,525.246C736.837,523.693 736.78,522.069 736.633,520.499C736.218,516.071 735.1,511.029 734.416,506.502C733.036,497.371 729.929,482.613 727.936,475.243C726.727,470.768 725.929,466.19 724.601,461.749C721.2,450.37 717.702,439.016 713.729,427.821C712.901,425.488 712.284,423.082 711.4,420.769C705.528,405.392 699.704,390.006 693.528,374.75C689.269,364.231 684.084,354.115 679.722,343.639C677.248,337.698 674.31,331.96 671.792,326.036Z"/><path d="M653.75,573.302C658.341,573.339 662.919,573.789 667.499,574.117C672.704,574.49 677.852,575.633 683.001,576.385C692.871,577.828 702.952,579.838 712.365,583.202C719.666,585.811 721.442,585.528 720.064,593.251C718.791,600.378 717.403,607.482 715.589,614.491C711.042,632.063 707.159,640.863 700.348,657.205C700.207,657.545 700.048,657.878 699.877,658.204C697.225,663.274 694.782,668.464 691.817,673.358C688.816,678.311 685.704,683.188 682.659,688.114C682.398,688.535 682.115,688.942 681.827,689.345C681.825,689.348 681.223,690.199 681.221,690.202C675.107,699.068 668.973,707.988 661.529,715.77C647.436,730.502 644.123,733.474 628.048,745.577C616.939,753.94 597.848,763.881 584.866,768.226C571.137,772.822 557.433,775.671 542.75,775.646C539.872,775.642 536.866,775.737 534,775.521C516.06,774.172 505.452,771.445 489.501,765.363C480.399,761.892 461.715,751.812 454.045,745.895C450.624,743.255 442.843,737.586 439.829,734.797C439.826,734.795 439.518,734.5 439.516,734.497C435.285,730.37 426.079,722.045 422.49,717.994C408.069,701.717 398.381,688.789 387.566,668.999C382.992,660.63 379.495,652.571 375.477,643.999C371.805,636.165 369.743,627.692 366.967,619.497C366.966,619.494 366.775,618.902 366.774,618.898C364.824,612.265 363.405,605.105 362.477,598.256C362.231,596.441 360.972,591.136 361.085,589.747C361.429,585.485 364.823,586.678 367.491,587.657C383.414,593.502 389.683,595.07 406.859,599.756C414.696,601.894 422.759,603.052 430.752,604.499C441.679,606.477 455.516,606.934 466.5,607.147C477.298,607.357 488.839,605.697 499.169,604.243C504.099,603.549 511.516,602.155 516.457,600.816C521.994,599.316 527.612,597.87 533.117,596.25C538.201,594.754 543.835,593.805 548.755,591.989C554.879,589.729 561.238,588.387 567.399,586.296C576.266,583.287 585.508,581.091 594.665,579.249C616.584,574.839 631.321,573.125 653.75,573.302Z"/></svg>`,
    cellar: P('<path d="M3 10 12 4l9 6v10H3z"/><path d="M7 20v-6h10v6M7 17h10"/>'),
    plus: P('<path d="M12 5v14M5 12h14"/>'),
    journal: P('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>'),
    places: P('<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    camera: P('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    glass: P('<path d="M7 3h10l-.7 6.5a4.3 4.3 0 0 1-8.6 0z"/><path d="M12 14v7M8.5 21h7"/>'),
    star: `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="vc-half"><stop offset="50%" style="stop-color:var(--gold)"/><stop offset="50%" style="stop-color:var(--line)"/></linearGradient></defs><path fill="currentColor" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>`,
    starHalf: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="url(#vc-half)" d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg>`,
    edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    trash: P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
    sparkle: P('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    back: P('<path d="M15 5 8 12l7 7"/>'),
    filter: P('<path d="M4 6h16M7 12h10M10 18h4"/>'),
    grid: P('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'),
    list: P('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
    move: P('<path d="M4 12h16M14 6l6 6-6 6"/>'),
    out: P('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>'),
    check: P('<path d="m5 12 4.5 4.5L19 7"/>'),
    thermo: P('<path d="M10 4a2 2 0 0 1 4 0v10a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>'),
    clock: P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    plate: P('<circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="9"/>'),
    gift: P('<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9C10 5 6.5 5 6.5 7.2S9.5 9 12 9zm0 0c2-4 5.5-4 5.5-1.8S14.5 9 12 9z"/>'),
    dots: P('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>'),
    share: P('<circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20a5 5 0 0 1 10 0M14 20a4 4 0 0 1 7 0"/>'),
    download: P('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>')
  };

  // ------------------------------------------------------------------ libellés
  const CATEGORY = { wine: "Vin", whisky: "Whisky", sake: "Saké", rum: "Rhum", brandy: "Cognac, armagnac, brandy", gin: "Gin", liqueur: "Liqueur", other: "Autre spiritueux" };
  const CATEGORY_SHORT = { wine: "Vin", whisky: "Whisky", sake: "Saké", rum: "Rhum", brandy: "Brandy", gin: "Gin", liqueur: "Liqueur", other: "Autre" };
  const STYLE = { red: "Rouge", white: "Blanc", rose: "Rosé", sparkling: "Mousseux", sweet: "Liquoreux / doux", fortified: "Muté (porto, xérès…)", orange: "Orange (macération)" };
  const KIND = { home: "Domicile", secondary: "Résidence secondaire", storage: "Dépôt / garde-meuble", office: "Bureau", other: "Autre" };
  const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];

  // Grandes régions viticoles (France, Suisse, Italie) et mots-clés pour y ranger les fiches existantes.
  const REGIONS = {
    France: { Alsace: "alsace", Beaujolais: "beaujolais|morgon|fleurie|moulin-a-vent|brouilly|julienas|chenas|chiroubles|regnie|saint-amour",
      Bordeaux: "bordeaux|medoc|pauillac|margaux|saint-julien|saint-estephe|pessac|graves|sauternes|barsac|saint-emilion|pomerol|fronsac|entre-deux-mers|blaye|bourg",
      Bourgogne: "bourgogne|burgundy|chablis|cote de nuits|cote de beaune|cote chalonnaise|maconnais|macon|pouilly-fuisse|gevrey|chambolle|vosne|nuits|meursault|puligny|chassagne|volnay|pommard|corton|beaune|mercurey|givry|rully|santenay|marsannay|morey",
      Champagne: "champagne", Corse: "corse|ajaccio|patrimonio", Jura: "jura|arbois|chateau-chalon|etoile",
      "Languedoc-Roussillon": "languedoc|roussillon|minervois|corbieres|faugeres|pic saint-loup|saint-chinian|terrasses du larzac|banyuls|collioure|maury|limoux|fitou",
      Loire: "loire|sancerre|pouilly-fume|vouvray|chinon|bourgueil|saumur|anjou|muscadet|savennieres|montlouis|menetou|quincy|reuilly|touraine",
      Provence: "provence|bandol|cassis|palette|bellet|baux", Rhone: "rhone|hermitage|cote-rotie|condrieu|cornas|saint-joseph|crozes|chateauneuf|gigondas|vacqueyras|rasteau|lirac|tavel|ventoux|luberon",
      Savoie: "savoie|apremont|chignin|abymes|roussette|crepy", "Sud-Ouest": "sud-ouest|cahors|madiran|jurancon|gaillac|bergerac|irouleguy|fronton|marcillac|buzet|monbazillac" },
    // Vaud : ses six régions AOC, Lavaux à part ; « Vaud » seul quand la région précise est introuvable.
    Suisse: { Lavaux: "lavaux|dezaley|calamin|epesses|saint-saphorin|st-saphorin|villette|lutry|cully|chexbres|riex|puidoux|chardonne|vevey|montreux|corseaux|grandvaux|aran|savuit|rivaz|treytorrens",
      Chablais: "chablais|yvorne|aigle|ollon|bex|villeneuve|antagnes",
      "La Cote": "la cote|mont-sur-rolle|rolle|fechy|feschy|morges|aubonne|nyon|begnins|vinzel|luins|tartegnin|bursins|perroy|coinsins|founex|allaman|yens|villars-sous-yens|essertines|gilly|bougy|mont-sur-nyon|duillier|coppet|tolochenaz|lully vd",
      "Cotes de l'Orbe": "cotes de l'orbe|orbe|arnex|valeyres|agiez|chavornay",
      Bonvillars: "bonvillars|grandson|concise|onnens|corcelles-pres-concise|champagne vd",
      Vully: "vully|motier|praz|mur vd|nant",
      Vaud: "vaud",
      Valais: "valais|wallis|sion|fully|chamoson|salquenen|salgesch|visperterminen|conthey|vetroz|leytron|sierre|saint-leonard", Geneve: "geneve|satigny|dardagny|lully|peissy|mandement",
      Neuchatel: "neuchatel|auvernier|cortaillod|cressier|boudry", "Lac de Bienne": "trois-lacs|bielersee|lac de bienne|ligerz|twann|schafis|erlach|cerlier|chavannes|tuscherz",
      Tessin: "tessin|ticino|mendrisio|lugano", "Suisse alemanique": "suisse alemanique|deutschschweiz|zurich|schaffhouse|schaffhausen|argovie|aargau|grisons|graubunden|bundner|malans|fläsch|flasch|jenins|thurgovie|thurgau|saint-gall|bale|basel|lucerne" },
    Italie: { Piemont: "piemont|piemonte|barolo|barbaresco|roero|langhe|asti|alba|gavi|ghemme|gattinara|monferrato|dogliani", "Vallee d'Aoste": "aoste|aosta",
      Lombardie: "lombardie|lombardia|franciacorta|valtellina|oltrepo|lugana", "Trentin-Haut-Adige": "trentin|trentino|haut-adige|alto adige|sudtirol|südtirol|teroldego",
      Venetie: "venetie|veneto|valpolicella|amarone|soave|prosecco|bardolino|recioto", "Frioul-Venetie julienne": "frioul|friuli|collio|colli orientali",
      Ligurie: "ligurie|liguria|cinque terre", "Emilie-Romagne": "emilie|emilia|romagna|lambrusco", Toscane: "toscane|toscana|tuscany|chianti|montalcino|brunello|montepulciano|bolgheri|maremma|morellino|carmignano|vernaccia",
      Ombrie: "ombrie|umbria|montefalco|orvieto|sagrantino", Marches: "marches|marche|verdicchio|conero", Latium: "latium|lazio|frascati",
      Abruzzes: "abruzzes|abruzzo|montepulciano d'abruzzo", Molise: "molise", Campanie: "campanie|campania|taurasi|fiano|greco di tufo|falanghina",
      Pouilles: "pouilles|puglia|primitivo|salice|manduria", Basilicate: "basilicate|basilicata|aglianico del vulture", Calabre: "calabre|calabria|ciro",
      Sicile: "sicile|sicilia|etna|marsala|nero d'avola|pantelleria", Sardaigne: "sardaigne|sardegna|cannonau|vermentino di gallura" }
  };
  // Noms affichés (les clés ci-dessus sont sans accents pour la comparaison).
  const REGION_LABEL = { "La Cote": "La Côte", "Cotes de l'Orbe": "Côtes de l'Orbe", Rhone: "Rhône", Geneve: "Genève", Neuchatel: "Neuchâtel", "Suisse alemanique": "Suisse alémanique", Piemont: "Piémont",
    "Vallee d'Aoste": "Vallée d'Aoste", Venetie: "Vénétie", "Frioul-Venetie julienne": "Frioul-Vénétie julienne", "Emilie-Romagne": "Émilie-Romagne" };
  const COUNTRY = { france: "France", suisse: "Suisse", switzerland: "Suisse", schweiz: "Suisse", svizzera: "Suisse", italie: "Italie", italy: "Italie", italia: "Italie",
    espagne: "Espagne", spain: "Espagne", "espana": "Espagne", portugal: "Portugal", allemagne: "Allemagne", germany: "Allemagne", deutschland: "Allemagne",
    autriche: "Autriche", austria: "Autriche", "etats-unis": "États-Unis", usa: "États-Unis", "united states": "États-Unis", argentine: "Argentine", argentina: "Argentine",
    chili: "Chili", chile: "Chili", "afrique du sud": "Afrique du Sud", "south africa": "Afrique du Sud", australie: "Australie", australia: "Australie",
    "nouvelle-zelande": "Nouvelle-Zélande", "new zealand": "Nouvelle-Zélande", japon: "Japon", japan: "Japon", ecosse: "Écosse", scotland: "Écosse", irlande: "Irlande", ireland: "Irlande",
    "royaume-uni": "Royaume-Uni", "united kingdom": "Royaume-Uni", grece: "Grèce", greece: "Grèce", liban: "Liban", lebanon: "Liban", hongrie: "Hongrie", hungary: "Hongrie" };
  const fold = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  function countryOf(it) {
    const c = fold(it.country);
    if (!c) return null;
    return COUNTRY[c] || it.country.trim().replace(/^./, (m) => m.toUpperCase());
  }
  function regionOf(it) {
    const c = countryOf(it);
    const table = REGIONS[c];
    const raw = (it.region || "").trim();
    if (!table) return raw || null;
    const r = fold(raw);
    // Une région générique (« Vaud », « Trois-Lacs ») ne suffit pas : on cherche d'abord la région précise.
    const generic = ["vaud", "trois-lacs", "trois lacs"].includes(r);
    if (!generic) for (const k of Object.keys(table)) if (fold(k) === r || fold(REGION_LABEL[k] || k) === r) return REGION_LABEL[k] || k;
    const hay = fold([it.region, it.appellation, it.name].join(" "));
    for (const [k, words] of Object.entries(table)) if (new RegExp(`(^|[^a-z])(${words})([^a-z]|$)`).test(hay)) return REGION_LABEL[k] || k;
    return raw || null;
  }
  // Prix de référence d'une fiche : marché, à défaut prix d'achat.
  const priceOf = (it) => (it.market_price != null ? Number(it.market_price) : it.purchase_price != null ? Number(it.purchase_price) : null);
  const PRICE_BANDS = [["0-20", "Moins de 20", 0, 20], ["20-40", "20 à 40", 20, 40], ["40-80", "40 à 80", 40, 80], ["80-150", "80 à 150", 80, 150], ["150-", "Plus de 150", 150, Infinity]];
  const regionList = (country) => Object.keys(REGIONS[country] || {}).map((k) => REGION_LABEL[k] || k);
  function regionSeal(region, country, count, index, selected = false) {
    const id = `region-arc-${index}`;
    const initial = (region.match(/\p{L}/u) || ["?"])[0].toLocaleUpperCase("fr");
    const nameSize = region.length > 22 ? 10 : region.length > 16 ? 11 : 13;
    return `<button type="button" class="region-seal" data-region="${esc(region)}" aria-pressed="${selected}" aria-label="${esc(region)}, ${esc(country)} : ${count} bouteille${count > 1 ? "s" : ""}">
      <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
        <defs><path id="${id}" d="M 24,82 A 56,56 0 0,1 136,82"/></defs>
        <circle class="seal-ring" cx="80" cy="80" r="76"/>
        <text class="seal-region" font-size="${nameSize}"><textPath href="#${id}" startOffset="50%" text-anchor="middle"${region.length > 24 ? ' textLength="154" lengthAdjust="spacingAndGlyphs"' : ""}>${esc(region.toLocaleUpperCase("fr"))}</textPath></text>
        <circle class="seal-dot" cx="15" cy="82" r="2"/><circle class="seal-dot" cx="145" cy="82" r="2"/>
        <text class="seal-initial" x="80" y="98" text-anchor="middle">${esc(initial)}</text>
        <text class="seal-country" x="80" y="130" text-anchor="middle">${esc(country.toLocaleUpperCase("fr"))}</text>
      </svg><span class="seal-count">${count} bouteille${count > 1 ? "s" : ""}</span></button>`;
  }

  // ------------------------------------------------------------------ utilitaires
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const year = new Date().getFullYear();
  const money = (n, cur = "CHF") => n == null || n === "" ? "" :
    new Intl.NumberFormat("de-CH", { style: "currency", currency: cur || "CHF", maximumFractionDigits: Number(n) % 1 ? 2 : 0 }).format(Number(n));
  const date = (d) => d ? new Date(d + (String(d).length === 10 ? "T12:00:00" : "")).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const today = () => new Date().toISOString().slice(0, 10);
  const range = (a, b, unit = "") => a && b ? (a === b ? `${a}${unit}` : `${a}–${b}${unit}`) : a ? `dès ${a}${unit}` : b ? `jusqu'à ${b}${unit}` : "";
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const isWine = (it) => (it.category || "wine") === "wine";
  const title = (it) => [it.producer, it.name].filter(Boolean).join(" · ");

  // Statut de la fenêtre de dégustation, du plus urgent au moins urgent.
  function windowStatus(it) {
    const { drink_from: f, drink_to: t, peak_from: pf, peak_to: pt } = it;
    if (!f && !t) return null;
    if (t && year > t) return { key: "past", label: "Fenêtre dépassée", rank: 0 };
    if (t && year >= t - 1) return { key: "soon", label: "À boire vite", rank: 1 };
    if (pf && pt && year >= pf && year <= pt) return { key: "peak", label: "À l'apogée", rank: 2 };
    if (f && year < f) return { key: "young", label: `Garder (dès ${f})`, rank: 4 };
    return { key: "ready", label: "Prêt à boire", rank: 3 };
  }

  // Bouteille dessinée quand aucune image n'est disponible.
  const LIQUID = {
    red: "#5A1525", white: "#D8C27A", rose: "#E6A0A6", sparkling: "#CDB866", sweet: "#C6862A", fortified: "#4A1A12", orange: "#D2873A",
    whisky: "#B0651F", sake: "#DCE6E1", rum: "#77401A", brandy: "#9A5524", gin: "#CFE2E5", liqueur: "#8A3B5A", other: "#8C7A6B"
  };
  function bottleSvg(it = {}) {
    const cat = it.category || "wine";
    const fill = cat === "wine" ? LIQUID[it.style] || LIQUID.red : LIQUID[cat] || LIQUID.other;
    const wine = "M24 4h12v26c0 6 10 10 10 22v62a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V52c0-12 10-16 10-22z";
    const spirit = "M25 4h10v14c0 3 13 6 13 16v80a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V34c0-10 13-13 13-16z";
    const d = cat === "wine" ? wine : spirit;
    return `<svg viewBox="0 0 60 122" aria-hidden="true"><path d="${d}" fill="${fill}" opacity=".9"/><path d="${d}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.2"/>
      <rect x="${cat === "wine" ? 17 : 15}" y="66" width="${cat === "wine" ? 26 : 30}" height="30" rx="2" fill="#FBF8F3" opacity=".92"/>
      <path d="M${cat === "wine" ? 21 : 19} 76h${cat === "wine" ? 18 : 22}M${cat === "wine" ? 23 : 21} 83h${cat === "wine" ? 14 : 18}" stroke="#6B1E2E" stroke-width="1.6" opacity=".55"/>
      <rect x="${cat === "wine" ? 23.5 : 24.5}" y="2" width="${cat === "wine" ? 13 : 11}" height="9" rx="1.5" fill="${cat === "wine" ? "#3A2A24" : "#6B4B2E"}"/></svg>`;
  }

  // ------------------------------------------------------------------ images privées (URL signées)
  const signedCache = new Map();
  async function signed(paths, bucket = "labels") {
    const parts = (p) => /^(studio-approved|studio-candidates):/.test(p || "") ? [p.slice(0,p.indexOf(":")),p.slice(p.indexOf(":")+1)] : [bucket,p];
    const key = (p) => parts(p).join("/");
    const fresh = (p) => (signedCache.get(key(p))?.expires || 0) > Date.now();
    const need = [...new Set(paths.filter((p) => p && !fresh(p)))];
    if (need.length && sb) {
      const buckets = [...new Set(need.map(p=>parts(p)[0]))];
      await Promise.all(buckets.map(async b => {
        const refs = need.filter(p=>parts(p)[0]===b), ttl = b.startsWith("studio-") ? 300 : 3600;
        const { data } = await sb.storage.from(b).createSignedUrls(refs.map(p=>parts(p)[1]), ttl);
        (data || []).forEach(r => r.signedUrl && signedCache.set(`${b}/${r.path}`, {url:r.signedUrl,expires:Date.now()+(b.startsWith("studio-") ? ttl-30 : 3300)*1000}));
      }));
    }
    return (p) => fresh(p) ? signedCache.get(key(p)).url : null;
  }
  // Vignette : bouteille Studio approuvée, couverture choisie, bouteille historique, puis étiquettes/photos.
  const mainImagePath = (it) => window.VC?.Studio?.ref(window.VC.Studio.asset(it,"bottle")) || it.cover_path || it.bottle_path || window.VC?.Studio?.ref(window.VC.Studio.asset(it,"label")) || it.label_path || (it.photo_paths || [])[0] || null;

  // Ne pas présenter une étiquette ou une photo ordinaire comme un détourage Studio.
  function imageInfo(it) {
    const path = mainImagePath(it);
    const studio = window.VC?.Studio, bottle = studio?.asset(it,"bottle"), label = studio?.asset(it,"label");
    if (path && path === studio?.ref(bottle)) return {path,kind:"bottle",label:"Bouteille Studio",reconstructed:bottle.provenance==="bottle_reconstructed"};
    if (path && path === studio?.ref(label)) return {path,kind:"label",label:"Étiquette restaurée"};
    if (path && path.includes("/visual-")) return { path, kind: "visual", label: "Visuel propre" };
    const kind = path && path === it.bottle_path ? "bottle" : path && [it.label_path, it.label_back_path].includes(path) ? "label" : "photo";
    return { path, kind, label: { bottle: "Bouteille", label: "Étiquette originale", photo: "Photo originale" }[kind] };
  }
  function itemVisual(it, getUrl) {
    const image = imageInfo(it), url = getUrl(image.path);
    return `<div class="thumb image-${image.kind}">${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async"><span class="image-fallback" hidden>${bottleSvg(it)}<span>Image indisponible</span></span>` : bottleSvg(it)}${image.reconstructed ? '<span class="studio-badge">Reconstituée</span>' : ""}</div>`;
  }
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (img.tagName !== "IMG" || !img.nextElementSibling?.classList.contains("image-fallback")) return;
    img.hidden = true; img.nextElementSibling.hidden = false;
  }, true);
  const lavauxCredit = () => `<a class="photo-credit" href="/credits.html">Lavaux · Photo Krzysztof Golik · CC BY-SA 4.0</a>`;
  const editorial = (title, text) => `<section class="terroir-banner" aria-label="${esc(title)}"><img src="/assets/img/lavaux/lavaux-leman.jpg" alt="Vignes en terrasses de Lavaux, Léman et Alpes" width="1280" height="329" decoding="async"><div class="terroir-copy"><span class="eyebrow">Vinicellar</span><h2>${esc(title)}</h2><p>${esc(text)}</p></div>${lavauxCredit()}</section>`;

  // ------------------------------------------------------------------ navigation
  const NAV = [
    { id: "cellar", href: "/app/", label: "Caves", icon: "cellar" },
    { id: "sommelier", href: "/app/sommelier.html", label: "Sommelier", icon: "plate" },
    { id: "add", href: "/app/ajouter.html", label: "Ajouter", icon: "plus" },
    { id: "out", href: "/app/sortir.html", label: "Sortir", icon: "glass" },
    { id: "carnet", href: "/app/journal.html", label: "Carnet", icon: "journal" }
  ];
  const DESKTOP = ["cellar", "sommelier", "carnet", "out"];
  // Sous-navigation du carnet : journal, bilan, historique, envies.
  const CARNET = [["journal", "/app/journal.html", "Journal"], ["bilan", "/app/bilan.html", "Bilan"], ["historique", "/app/historique.html", "Historique"], ["envies", "/app/envies.html", "Envies"]];
  const carnetNav = (active) => `<nav class="chips subnav" aria-label="Carnet">${CARNET.map(([id, href, l]) => `<a class="chip" href="${href}" aria-pressed="${id === active}"${id === active ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
  function renderNav(active) {
    const top = $("#topbar");
    if (top) {
      top.className = "topbar";
      top.innerHTML = `<div class="wrap"><a class="brand" href="/app/">${I.logo}<span>Vinicellar</span></a>
        <nav class="nav" aria-label="Navigation principale">
          ${DESKTOP.map((id) => NAV.find((n) => n.id === id)).map((n) => `<a href="${n.href}"${n.id === active ? ' aria-current="page"' : ""}>${n.id === "out" ? "Sortir une bouteille" : n.label}</a>`).join("")}
          <a href="/app/compte.html"${active === "account" ? ' aria-current="page"' : ""}>Compte</a>
          <a class="btn" href="/app/ajouter.html">${I.plus}Ajouter</a>
        </nav><button class="icon-btn theme-toggle" data-theme-toggle type="button" aria-label="Changer de thème">◐</button><a class="me" href="/app/compte.html" aria-label="Mon compte">${I.user}</a></div>`;
    }
    const tab = $("#tabbar");
    if (tab) {
      tab.className = "tabbar";
      tab.setAttribute("aria-label", "Navigation");
      tab.innerHTML = NAV.map((n) => n.id === "add"
        ? `<a class="tab-add" href="${n.href}"${n.id === active ? ' aria-current="page"' : ""}><span class="plus">${I.plus}</span><span class="sr">${n.label}</span></a>`
        : `<a href="${n.href}"${n.id === active ? ' aria-current="page"' : ""}>${I[n.icon]}<span>${n.label}</span></a>`).join("");
    }
    applyTheme();
  }

  // ------------------------------------------------------------------ session
  // Rôle par collection : owner et member modifient, viewer consulte seulement.
  let roles = new Map();
  const canEdit = (collectionId) => ["owner", "member"].includes(roles.get(collectionId));
  async function boot(active) {
    renderNav(active);
    if (!sb) { location.replace("/"); return new Promise(() => {}); }
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.replace("/?next=" + encodeURIComponent(location.pathname + location.search)); return new Promise(() => {}); }
    const user = data.session.user;
    const { data: profile, error: pe } = await sb.from("profiles").select("*").eq("id", user.id).single();
    // Pas de réseau (app ouverte depuis l'écran d'accueil hors connexion) : on le dit, sans renvoyer vers l'accueil.
    if (pe && !profile && pe.code !== "PGRST116") {
      const m = $("#main");
      if (m) m.innerHTML = `<div class="empty">${I.glass}<h2>Hors ligne</h2><p class="muted">Vos caves sont en ligne. Reconnectez-vous au réseau, puis réessayez.</p><button class="btn" id="vc-retry">Réessayer</button></div>`;
      $("#vc-retry")?.addEventListener("click", () => location.reload());
      window.addEventListener("online", () => location.reload(), { once: true });
      return new Promise(() => {});
    }
    if (!profile || !profile.onboarded_at) { location.replace("/bienvenue.html"); return new Promise(() => {}); }
    const { data: mem } = await sb.from("collection_members").select("collection_id, role").eq("user_id", user.id);
    roles = new Map((mem || []).map((m) => [m.collection_id, m.role]));
    sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "ready").then(({ count }) => {
      if (!count) return;
      $$('a[href="/app/ajouter.html"]').forEach((a) => { a.classList.add("has-badge"); a.insertAdjacentHTML("beforeend", `<span class="badge">${count}</span>`); });
    });
    return { user, profile };
  }

  // ------------------------------------------------------------------ toasts et erreurs
  let toastTimer;
  function toast(text, action) {
    $(".toast")?.remove();
    clearTimeout(toastTimer);
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML = `<span>${esc(text)}</span>`;
    if (action) {
      const b = document.createElement("button");
      b.textContent = action.label;
      b.addEventListener("click", () => { el.remove(); action.run(); });
      el.append(b);
    }
    document.body.append(el);
    toastTimer = setTimeout(() => el.remove(), action ? 7000 : 3500);
  }
  function fail(error, fallback = "Une erreur est survenue.") {
    console.error(error);
    const m = error && error.message ? error.message : "";
    toast(/aucune bouteille|pas assez|invalide|introuvable/.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) + "." : fallback);
  }

  // ------------------------------------------------------------------ étoiles (0 à 5, demi-points)
  function stars(value, onChange, { read = false, label = "Note" } = {}) {
    const box = document.createElement("div");
    box.className = "stars" + (read ? " read" : "");
    box.setAttribute("role", read ? "img" : "group");
    box.setAttribute("aria-label", `${label} : ${value ? String(value).replace(".", ",") : "aucune"} sur 5`);
    let v = Number(value) || 0;
    const draw = () => {
      box.innerHTML = "";
      for (let i = 1; i <= 5; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = v >= i ? "on" : v >= i - .5 ? "half" : "";
        b.innerHTML = v >= i ? I.star : v >= i - .5 ? I.starHalf : I.star;
        if (!read) {
          b.setAttribute("aria-label", `${i} étoile${i > 1 ? "s" : ""}`);
          // Toucher une étoile : note entière ; la retoucher : demi-étoile ; une troisième fois : efface.
          // preventDefault : Safari iOS renvoie sinon le toucher vers la première étoile quand le widget est dans un <label>.
          b.addEventListener("click", (e) => {
            e.preventDefault(); e.stopPropagation();
            v = v === i ? i - .5 : v === i - .5 ? 0 : i;
            draw(); onChange && onChange(v || null);
          });
        }
        box.append(b);
      }
    };
    draw();
    box.value = () => v || null;
    return box;
  }

  // ------------------------------------------------------------------ formulaire de fiche (ajout et modification)
  const F = (k, label, type = "text", extra = {}) => ({ k, label, type, ...extra });
  const SECTIONS = [
    { legend: "Identité", fields: [
      F("category", "Type", "select", { opts: CATEGORY }),
      F("style", "Couleur / style", "select", { opts: STYLE, empty: "—", wineOnly: true }),
      F("name", "Nom de la cuvée", "text", { required: true, wide: true, placeholder: "ex. Dézaley Grand Cru Médinette" }),
      F("producer", "Producteur / domaine / distillerie"),
      F("vintage", "Millésime", "number", { min: 1800, max: 2100, placeholder: "ex. 2019" }),
      F("country", "Pays"),
      F("region", "Région", "text", { list: "vc-regions" }),
      F("appellation", "Appellation"),
      F("grapes", "Cépages (séparés par des virgules)", "csv", { wineOnly: true, wide: true }),
      F("abv", "Degré (% vol.)", "number", { step: .1, min: 0, max: 100 }),
      F("volume_cl", "Contenance (cl)", "number", { min: 1, max: 3000 }),
      F("producer_url", "Site du producteur", "url", { wide: true, placeholder: "https://" })
    ] },
    { legend: "Garde et service", fields: [
      F("drink_from", "Fenêtre idéale, de", "number", { min: 1800, max: 2200 }),
      F("drink_to", "jusqu'à", "number", { min: 1800, max: 2200 }),
      F("aging_potential_years", "Garde recommandée (années)", "number", { min: 0, max: 200 }),
      F("peak_from", "Apogée, de", "number", { min: 1800, max: 2200 }),
      F("peak_to", "jusqu'à", "number", { min: 1800, max: 2200 }),
      F("window_source", "Source de la fenêtre", "text", { placeholder: "ex. producteur, estimation" }),
      F("serving_temp_min", "Service, de (°C)", "number", { min: -5, max: 30 }),
      F("serving_temp_max", "à (°C)", "number", { min: -5, max: 30 })
    ] },
    { legend: "Description", fields: [
      F("description", "Le vin", "textarea", { wide: true }),
      F("vinification", "Vinification / élaboration", "textarea", { wide: true }),
      F("terroir", "Sols et climat", "textarea", { wide: true }),
      F("vintage_notes", "Particularités du millésime ou de la cuvée", "textarea", { wide: true }),
      F("pairings", "Accords mets (un par ligne)", "lines", { wide: true }),
      F("details", "Détails (une ligne « clé : valeur », ex. Âge : 18 ans)", "kv", { wide: true })
    ] },
    { legend: "Notes et prix", fields: [
      F("avg_score", "Note moyenne", "number", { step: .1, min: 0, max: 100 }),
      F("avg_score_scale", "Sur", "select", { opts: { 5: "/5", 10: "/10", 20: "/20", 100: "/100" }, empty: "—" }),
      F("avg_score_source", "Source de la note"),
      F("market_price", "Prix du marché", "number", { step: .05, min: 0 }),
      F("market_currency", "Devise", "select", { opts: Object.fromEntries(CURRENCIES.map((c) => [c, c])) }),
      F("price_source", "Source du prix"),
      F("purchase_price", "Mon prix d'achat", "number", { step: .05, min: 0 }),
      F("purchase_currency", "Devise", "select", { opts: Object.fromEntries(CURRENCIES.map((c) => [c, c])) }),
      F("purchase_year", "Année d'achat", "number", { min: 1900, max: 2100 }),
      F("purchase_place", "Acheté chez", "text", { wide: true }),
      F("notes", "Mes remarques", "textarea", { wide: true })
    ] }
  ];

  function fieldValue(f, it) {
    const v = it[f.k];
    if (f.type === "csv") return (v || []).join(", ");
    if (f.type === "lines") return (v || []).join("\n");
    if (f.type === "kv") return Object.entries(v || {}).map(([a, b]) => `${a} : ${b}`).join("\n");
    return v ?? "";
  }

  function renderItemForm(form, it = {}, { currency = "CHF" } = {}) {
    const data = { category: "wine", market_currency: currency, purchase_currency: currency, volume_cl: 75, ...it };
    form.innerHTML = SECTIONS.map((s) => `<fieldset><legend>${s.legend}</legend><div class="grid2">${s.fields.map((f) => {
      const val = esc(fieldValue(f, data));
      const attrs = `name="${f.k}"${f.required ? " required" : ""}${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}${f.step ? ` step="${f.step}"` : ""}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${f.list ? ` list="${f.list}"` : ""}`;
      let input;
      if (f.type === "select") {
        input = `<select ${attrs}>${f.empty ? `<option value="">${f.empty}</option>` : ""}${Object.entries(f.opts).map(([k, l]) => `<option value="${k}"${String(data[f.k] ?? "") === k ? " selected" : ""}>${l}</option>`).join("")}</select>`;
      } else if (f.type === "textarea" || f.type === "lines" || f.type === "kv") {
        input = `<textarea ${attrs} rows="${f.type === "textarea" ? 3 : 4}">${val}</textarea>`;
      } else {
        input = `<input ${attrs} type="${f.type === "csv" ? "text" : f.type}" value="${val}"${f.type === "number" ? ' inputmode="decimal"' : ""}>`;
      }
      return `<label${f.wide ? ' class="wide"' : ""}${f.wineOnly ? " data-wine-only" : ""}>${f.label}${input}</label>`;
    }).join("")}</div></fieldset>`).join("");
    form.insertAdjacentHTML("beforeend", `<datalist id="vc-regions">${Object.keys(REGIONS).flatMap(regionList).map((r) => `<option value="${esc(r)}">`).join("")}</datalist>`);
    const cat = form.querySelector('[name="category"]');
    const sync = () => $$("[data-wine-only]", form).forEach((el) => (el.hidden = cat.value !== "wine"));
    cat.addEventListener("change", sync);
    sync();
  }

  function readItemForm(form) {
    const out = {};
    for (const s of SECTIONS) for (const f of s.fields) {
      const el = form.elements[f.k];
      if (!el) continue;
      const raw = el.value.trim();
      if (f.type === "number") out[f.k] = raw === "" ? null : Number(raw.replace(",", "."));
      else if (f.type === "csv") out[f.k] = raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
      else if (f.type === "lines") out[f.k] = raw ? raw.split("\n").map((x) => x.trim()).filter(Boolean) : [];
      else if (f.type === "kv") out[f.k] = Object.fromEntries(raw.split("\n").map((l) => l.split(/\s*:\s*/)).filter((p) => p[0] && p.length > 1).map(([a, ...b]) => [a.trim(), b.join(" : ").trim()]));
      else if (f.k === "avg_score_scale") out[f.k] = raw ? Number(raw) : null;
      else out[f.k] = raw || null;
    }
    if (out.category !== "wine") { out.style = null; }
    if (out.producer_url && !safeUrl(out.producer_url)) out.producer_url = safeUrl("https://" + out.producer_url);
    return out;
  }

  // Champs renvoyés par l'analyse IA et copiés tels quels dans la fiche.
  const AI_FIELDS = ["category", "style", "name", "producer", "producer_url", "vintage", "country", "region", "appellation", "grapes", "abv", "volume_cl",
    "description", "vinification", "terroir", "vintage_notes", "pairings", "serving_temp_min", "serving_temp_max", "drink_from", "drink_to",
    "peak_from", "peak_to", "aging_potential_years", "window_source", "avg_score", "avg_score_scale", "avg_score_source", "market_price",
    "market_currency", "price_source", "details"];

  // Appel de la fonction d'analyse (photo et/ou nom).
  async function identify(payload) {
    const { data, error } = await sb.functions.invoke("identify", { body: payload });
    if (error) {
      let msg = "L'analyse a échoué.";
      try { const j = await error.context.json(); if (j && j.message) msg = j.message; } catch { /* réponse vide */ }
      throw new Error(msg);
    }
    return data;
  }

  // Redimensionne une photo (côté navigateur) : envoi plus rapide, quota de stockage préservé.
  async function shrink(file, max = 1600, quality = .85) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
      const b64 = c.toDataURL("image/jpeg", quality).split(",")[1];
      return { blob, b64, preview: URL.createObjectURL(blob) };
    } finally { URL.revokeObjectURL(url); }
  }


  // ------------------------------------------------------------------ cave affichée (mémorisée sur l'appareil)
  const LOC_KEY = "vc.loc";
  const getLoc = () => { try { return localStorage.getItem(LOC_KEY) || ""; } catch { return ""; } };
  const setLoc = (id) => { try { localStorage.setItem(LOC_KEY, id || ""); } catch { /* stockage indisponible */ } };

  // Caves accessibles (les miennes et celles partagées avec moi), avec le nom de leur collection.
  async function loadPlaces() {
    const { data, error } = await sb.from("locations").select("*, collections(id, name, owner_id)").order("position").order("created_at");
    if (error) throw error;
    return data || [];
  }
  const placeLabel = (p, all) => {
    const shared = new Set((all || []).map((x) => x.collection_id)).size > 1;
    return shared && p.collections ? `${p.name} · ${p.collections.name}` : p.name;
  };

  // ------------------------------------------------------------------ feuille (dialogue en bas d'écran sur mobile)
  function sheet(html) {
    const d = document.createElement("dialog");
    d.innerHTML = `<div class="dlg">${html}</div>`;
    const heading = d.querySelector("h2");
    if (heading) {
      d.setAttribute("aria-label", heading.textContent);
    }
    document.body.append(d);
    d.addEventListener("close", () => d.remove());
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-close]")) d.close(); });
    d.showModal();
    return d;
  }

  // ------------------------------------------------------------------ sortir une bouteille : bue, offerte, autre
  // item : la fiche ; stock : ses lignes de stock ; places : caves ; loc : cave affichée (facultatif).
  function takeOut({ item, stock, places, loc, onDone }) {
    if (!canEdit(item.collection_id)) { toast("Cave partagée en lecture seule."); return; }
    const rows = stock.filter((s) => s.quantity > 0);
    const here = rows.filter((s) => s.location_id === loc);
    const list = here.length ? here : rows;
    if (!list.length) { toast("Plus aucune bouteille en stock."); return; }
    const pname = (id) => (places.find((p) => p.id === id) || {}).name || "Cave";
    const d = sheet(`<h2>${esc(item.name)}${item.vintage ? ` <span class="faint">${item.vintage}</span>` : ""}</h2>
      ${list.length > 1
        ? `<label>Depuis<select id="to-loc">${list.map((s) => `<option value="${s.location_id}">${esc(pname(s.location_id))} (${s.quantity})</option>`).join("")}</select></label>`
        : `<p class="muted" style="margin:0">Depuis ${esc(pname(list[0].location_id))} · ${list[0].quantity} en stock</p>`}
      <div class="choices">
        <button type="button" class="choice" data-r="drunk">${I.glass}<b>Bue</b><small>On l'a ouverte</small></button>
        <button type="button" class="choice" data-r="gifted">${I.gift}<b>Offerte</b><small>Cadeau, invitation</small></button>
        <button type="button" class="choice" data-r="other">${I.dots}<b>Autre</b><small>Bouchonnée, cassée, vendue</small></button>
      </div>
      <form id="to-extra" hidden novalidate>
        <label id="to-extra-label">À qui ?<input name="who" maxlength="120" autocomplete="off"></label>
        <div class="row end" style="margin-top:14px"><button type="submit" class="btn">${I.check}Valider</button></div>
      </form>
      <div class="row end" style="margin-top:8px"><button type="button" class="btn quiet" data-close>Annuler</button></div>`);
    const locId = () => (d.querySelector("#to-loc") || {}).value || list[0].location_id;
    let reason = null;

    async function record(r, extra) {
      const { data: tid, error } = await sb.rpc("take_bottle", {
        p_item: item.id, p_location: locId(), p_reason: r,
        p_recipient: r === "gifted" ? extra || null : null, p_notes: r === "other" ? extra || null : null
      });
      if (error) { fail(error); return null; }
      onDone && onDone();
      return tid;
    }
    const undo = (tid) => async () => { await sb.rpc("undo_tasting", { p_tasting: tid }); toast("Sortie annulée."); onDone && onDone(); };

    d.querySelector(".choices").addEventListener("click", async (e) => {
      const b = e.target.closest(".choice");
      if (!b) return;
      reason = b.dataset.r;
      d.querySelectorAll(".choice").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (reason !== "drunk") {
        const f = d.querySelector("#to-extra");
        f.hidden = false;
        d.querySelector("#to-extra-label").firstChild.textContent = reason === "gifted" ? "À qui ? (facultatif)" : "Que s'est-il passé ? (facultatif)";
        f.who.placeholder = reason === "gifted" ? "ex. Famille Sciboz, dîner chez Paul" : "ex. Bouchonnée";
        f.who.focus();
        return;
      }
      // Bue : retirée tout de suite, puis note de dégustation facultative.
      d.querySelectorAll(".choice").forEach((x) => (x.disabled = true));
      const tid = await record("drunk");
      if (!tid) return d.close();
      let rating = null;
      d.querySelector(".dlg").innerHTML = `<h2>Santé !</h2><p class="muted">Bouteille retirée du stock. Une note pour vous en souvenir ?</p>
        <div class="field-label">Ma note <small class="faint">(retoucher une étoile : demi-point)</small><div id="to-stars"></div></div>
        <label style="margin-top:12px">Avec quel plat ?<input name="pairing" maxlength="300" placeholder="ex. Filets de perche"></label>
        <label style="margin-top:12px">Commentaire<textarea name="notes" rows="3" placeholder="Nez, bouche, évolution…"></textarea></label>
        <div class="row" style="margin-top:16px"><button type="button" class="btn quiet" id="to-undo">Annuler la sortie</button><span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Plus tard</button><button type="button" class="btn" id="to-save">Enregistrer</button></div>`;
      d.querySelector("#to-stars").append(stars(null, (v) => (rating = v), { label: "Note de dégustation" }));
      d.querySelector("#to-undo").addEventListener("click", async () => { d.close(); await undo(tid)(); });
      d.querySelector("#to-save").addEventListener("click", async () => {
        const patch = { rating, pairing: d.querySelector("[name=pairing]").value.trim() || null, notes: d.querySelector("[name=notes]").value.trim() || null };
        const { error } = await sb.from("tastings").update(patch).eq("id", tid);
        if (error) return fail(error);
        if (rating && !item.my_rating) await sb.from("items").update({ my_rating: rating }).eq("id", item.id);
        d.close(); toast("Note enregistrée."); onDone && onDone();
      });
    });

    d.querySelector("#to-extra").addEventListener("submit", async (e) => {
      e.preventDefault();
      const who = e.target.who.value.trim();
      e.target.querySelector("button").disabled = true;
      const tid = await record(reason, who);
      d.close();
      if (tid) toast(reason === "gifted" ? "Bouteille offerte, retirée du stock." : "Bouteille retirée du stock.", { label: "Annuler", run: undo(tid) });
    });
  }

  // Listes d'envies d'une collection ; crée « À acheter » s'il n'y en a aucune.
  async function wishlistsFor(collectionId) {
    const { data } = await sb.from("wishlists").select("*").eq("collection_id", collectionId).order("position").order("created_at");
    if ((data || []).length) return data;
    const { data: w } = await sb.from("wishlists").insert({ collection_id: collectionId, name: "À acheter" }).select("*").single();
    return w ? [w] : [];
  }

  // Ressemblance entre deux fiches (même vin ?), insensible aux accents, à l'ordre des mots
  // et aux mots génériques (domaine, château, grand cru…). Retourne un score de 0 à 1.
  const STOP = new Set("domaine chateau cave caves maison tenuta weingut bodega bodegas cantina azienda agricola clos mas famille fils freres et de du des la le les l d di del della the of grand premier cru crus aoc aop doc docg igt vin vins wine sa".split(" "));
  const tokens = (...xs) => new Set(xs.join(" ").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t) && !/^(19|20)\d\d$/.test(t)));
  const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const t of a) if (b.has(t)) n++; return n / Math.min(a.size, b.size); };
  function likeness(a, b) {
    const prodA = tokens(a.producer || ""), prodB = tokens(b.producer || "");
    const all = overlap(tokens(a.producer || "", a.name || ""), tokens(b.producer || "", b.name || ""));
    const nameScore = overlap(tokens(a.name || ""), tokens(b.name || ""));
    const prodScore = prodA.size && prodB.size ? overlap(prodA, prodB) : null;
    if (prodScore === 0) return 0;                       // producteurs connus et différents : pas le même vin
    return Math.max(all, prodScore == null ? nameScore : (nameScore + prodScore) / 2);
  }
  // Fiches existantes qui ressemblent à `it` : { item, score, sameVintage }, les plus probables d'abord.
  function lookalikes(it, list) {
    return list.map((x) => ({ item: x, score: likeness(it, x), sameVintage: (x.vintage || null) === (it.vintage || null) }))
      .filter((m) => m.score >= 0.6).sort((a, b) => (b.sameVintage - a.sameVintage) || (b.score - a.score)).slice(0, 3);
  }

  const REASON = { drunk: "Bue", gifted: "Offerte", other: "Sortie" };

  // ------------------------------------------------------------------ app installée (PWA)
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  if (standalone) document.documentElement.classList.add("standalone");
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  }
  // Android et Chrome proposent une invite ; on la garde pour le bouton « Installer ».
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; document.dispatchEvent(new Event("vc:installable")); });
  // Astuce d'installation (page « Quelle cave ? ») : Safari sur iPhone n'a pas d'invite, il faut passer par Partager.
  function installHint(host) {
    if (!host || standalone) return;
    try { if (localStorage.getItem("vc.pwa-hint") === "1") return; } catch { /* stockage indisponible : on affiche */ }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const show = (text, withInstall) => {
      if (host.querySelector(".pwa-hint")) return;
      const box = document.createElement("aside");
      box.className = "invite pwa-hint"; box.setAttribute("role", "note");
      box.innerHTML = `<div><b>Vinicellar comme une app</b><br><small class="muted">${text}</small></div>
        <div class="row">${withInstall ? `<button class="btn" data-install>${I.plus}Installer</button>` : ""}<button class="btn ghost" data-ok>${withInstall ? "Plus tard" : "Compris"}</button></div>`;
      box.addEventListener("click", async (e) => {
        if (e.target.closest("[data-install]") && installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; }
        else if (!e.target.closest("[data-ok]")) return;
        try { localStorage.setItem("vc.pwa-hint", "1"); } catch { /* tant pis */ }
        box.remove();
      });
      host.prepend(box);
    };
    if (ios) show("Dans Safari, touchez Partager (le carré avec une flèche), puis « Sur l'écran d'accueil ». Elle s'ouvrira en plein écran, comme une app.", false);
    else if (installEvt) show("Ajoutez-la à votre écran d'accueil : elle s'ouvrira en plein écran.", true);
    else document.addEventListener("vc:installable", () => show("Ajoutez-la à votre écran d'accueil : elle s'ouvrira en plein écran.", true), { once: true });
  }

  window.VC = {
    sb, cfg, I, CATEGORY, CATEGORY_SHORT, STYLE, KIND, CURRENCIES, AI_FIELDS,
    $, $$, esc, money, date, today, year, range, safeUrl, host, isWine, title,
    windowStatus, bottleSvg, signed, mainImagePath, imageInfo, itemVisual, editorial, renderNav, boot, toast, fail, stars,
    renderItemForm, readItemForm, identify, shrink,
    carnetNav, wishlistsFor, canEdit, lookalikes, likeness, getLoc, setLoc, loadPlaces, placeLabel, sheet, takeOut, installHint, getVisualBg, setVisualBg, standalone, REASON, REGIONS, countryOf, regionOf, regionList, regionSeal, fold, priceOf, PRICE_BANDS
  };
})();
