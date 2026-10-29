/**
 * Shared stack of open BaseModal instances, so only the topmost reacts to
 * ESC/backdrop and global shortcuts can tell whether a modal is open.
 */

const openModalIds: number[] = [];
let nextModalId = 1;

export function allocateModalId(): number {
  const id = nextModalId;
  nextModalId += 1;
  return id;
}

export function pushModal(id: number): void {
  openModalIds.push(id);
}

export function removeModal(id: number): void {
  const index = openModalIds.indexOf(id);
  if (index !== -1) {
    openModalIds.splice(index, 1);
  }
}

export function isTopModal(id: number): boolean {
  return openModalIds[openModalIds.length - 1] === id;
}

export function isAnyModalOpen(): boolean {
  return openModalIds.length > 0;
}
