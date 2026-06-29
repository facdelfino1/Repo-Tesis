export function renderSelectOptions(select, items, valueFactory, labelFactory) {
    items.forEach((item) => {
        const option = document.createElement("option");
        option.value = valueFactory(item);
        option.textContent = labelFactory(item);
        select.appendChild(option);
    });
}

export function resetSelect(select, firstLabel = "") {
    select.innerHTML = "";

    if (firstLabel !== null) {
        const firstOption = document.createElement("option");
        firstOption.value = "";
        firstOption.textContent = firstLabel;
        select.appendChild(firstOption);
    }
}

export function fillSelect(select, firstLabel, items, valueFactory, labelFactory) {
    resetSelect(select, firstLabel);
    renderSelectOptions(select, items, valueFactory, labelFactory);
}
