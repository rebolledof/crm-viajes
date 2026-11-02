"use client";

// Reemplaza los mensajes de validación del navegador por mensajes en español en todos los
// formularios (los de ActionForm y los sencillos). El evento "invalid" no burbujea, así que se
// escucha en fase de captura; al escribir de nuevo se borra el mensaje para volver a validar.
import { useEffect } from "react";
import { validationMessage } from "@/domain/validation";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isField(el: EventTarget | null): el is Field {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

/** Texto de la etiqueta sin las opciones de un select ni el valor del campo. */
function labelOf(el: Field): string | null {
  const label = el.labels?.[0];
  if (!label) return el.getAttribute("aria-label");
  const span = label.querySelector("span");
  if (span && !span.contains(el)) return span.textContent;
  if (label.contains(el)) return null;
  return label.textContent;
}

export function SpanishValidation() {
  useEffect(() => {
    const onInvalid = (e: Event) => {
      const el = e.target;
      if (!isField(el)) return;
      el.setCustomValidity("");
      const msg = validationMessage(el.validity, {
        tag: el.tagName.toLowerCase(),
        type: el instanceof HTMLInputElement ? el.type : undefined,
        label: labelOf(el),
        min: el.getAttribute("min") ?? undefined,
        max: el.getAttribute("max") ?? undefined,
        step: el.getAttribute("step") ?? undefined,
        minLength: "minLength" in el ? el.minLength : undefined,
        maxLength: "maxLength" in el ? el.maxLength : undefined,
        length: "value" in el && typeof el.value === "string" ? el.value.length : undefined,
        title: el.title,
      });
      if (msg) el.setCustomValidity(msg);
    };
    const onChange = (e: Event) => {
      if (isField(e.target)) e.target.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onChange, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onChange, true);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
  return null;
}
