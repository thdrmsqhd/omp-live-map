"use strict";

if (window.engineeringDesktop) {
  const link = document.createElement("a");
  link.href = "/engineering.html";
  link.textContent = "Engineering";
  document.getElementById("spath").before(link);
}
