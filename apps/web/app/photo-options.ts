"use client";

export type PhotoOption = {
  value: string;
  label: string;
  isSystem?: boolean;
};

export const defaultTradeOptions: PhotoOption[] = [
  { value: "WATERPROOF", label: "방수" },
  { value: "TILE", label: "타일" },
  { value: "PAINT", label: "도장" },
  { value: "ELECTRIC", label: "전기" },
  { value: "MEP", label: "기계/설비" },
  { value: "WINDOW", label: "창호" },
  { value: "CONCRETE", label: "콘크리트" },
  { value: "OTHER", label: "기타" }
];

export const defaultSurfaceOptions: PhotoOption[] = [
  { value: "FLOOR", label: "바닥" },
  { value: "ENTRY_WALL", label: "기준벽(출입문)" },
  { value: "FRONT_WALL", label: "전면벽" },
  { value: "RIGHT_WALL", label: "우측벽" },
  { value: "LEFT_WALL", label: "좌측벽" },
  { value: "WALL", label: "벽(기타)" },
  { value: "CEILING", label: "천장" },
  { value: "WINDOW", label: "창호" },
  { value: "DOOR", label: "문" },
  { value: "PIPE", label: "배관" },
  { value: "ELECTRIC", label: "전기" },
  { value: "OTHER", label: "기타" }
];

export function labelForOption(options: PhotoOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function legacyTradeValue(value: string) {
  const option = defaultTradeOptions.find((trade) => trade.value === value);
  return option?.value ?? "OTHER";
}
