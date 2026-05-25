/** Select 第一项「一键全选」的哨兵值，不会作为真实值传给接口 */

export const SELECT_ALL_CREATOR_ACCOUNTS = "__toolbar_all_creator_accounts__";

export const SELECT_ALL_CREATOR_EXPORT = "__toolbar_all_creator_export_accounts__";

export const SELECT_ALL_SHOPS = "__toolbar_all_shop_export_shops__";

export function buildSelectAllOption(count: number, label: string) {
  return {
    label,
    disabled: count === 0,
  };
}

export function resolveSelectAllChange(
  picked: string[],
  token: string,
  allValues: string[]
): string[] {
  if (picked.includes(token)) {
    return [...allValues];
  }
  return picked.filter((value) => value !== token);
}

export function sanitizeSelected(selected: string[], allowed: string[]): string[] {
  return selected.filter((value) => allowed.includes(value));
}
