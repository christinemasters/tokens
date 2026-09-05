document.addEventListener("DOMContentLoaded", () => {
  const status = document.querySelector("#press-copy-status");

  document.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.copyTarget);
      if (!target || !status) return;

      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        status.textContent = "Copied. Paste it into your agent's conversation.";
      } catch {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(target);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        status.textContent = "Automatic copying is unavailable. Select and copy the text above.";
      }
    });
  });
});
