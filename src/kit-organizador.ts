import "./pagina";
import "./kit-organizador.css";

// The cards and QR are already public, static HTML/SVG: printing never waits for
// canvas, account state, a remote QR service, or a dynamically imported library.
const resetPrint = (): void => { delete document.documentElement.dataset.kitPrint; };
window.addEventListener("afterprint", resetPrint);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-kit-print]")) {
  button.addEventListener("click", () => {
    document.documentElement.dataset.kitPrint = button.dataset.kitPrint;
    try {
      window.print();
    } catch (error) {
      resetPrint();
      throw error;
    }
  });
}
