// The containing app's screen. ViewController.swift calls show() once it
// knows whether the extension is on, and answers the messages posted here.

function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) {
        document.querySelector("button.open-preferences").innerText = "Quit and Open Safari Settings…";
    }
    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function post(message) {
    webkit.messageHandlers.controller.postMessage(message);
}

document.querySelector("button.open-preferences").addEventListener("click", () => post("open-preferences"));

// Links open in the default browser or mail app, not inside this window.
for (const link of document.querySelectorAll("a[data-open]")) {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        post("open:" + link.href);
    });
}
