export const ASA_MAPS = [
  {
    id: "TheIsland_WP",
    displayNameZh: "孤岛",
    englishName: "The Island",
    typeZh: "官方剧情地图",
    descriptionZh: "ARK 的经典起始地图，森林、雪山、火山和海洋生态完整。",
  },
  {
    id: "ScorchedEarth_WP",
    displayNameZh: "焦土",
    englishName: "Scorched Earth",
    typeZh: "官方剧情地图",
    descriptionZh: "沙漠主题地图，强调高温、风暴、水源管理和飞龙生态。",
  },
  {
    id: "TheCenter_WP",
    displayNameZh: "中心岛",
    englishName: "The Center",
    typeZh: "官方非剧情地图",
    aliasesZh: ["中心"],
    descriptionZh: "大型奇观地图，包含浮岛、地下世界和多样化地貌。",
  },
  {
    id: "Aberration_WP",
    displayNameZh: "畸变",
    englishName: "Aberration",
    typeZh: "官方剧情地图",
    descriptionZh: "地下方舟地图，包含辐射区域、攀爬探索和畸变生物群系。",
  },
  {
    id: "Extinction_WP",
    displayNameZh: "灭绝",
    englishName: "Extinction",
    typeZh: "官方剧情地图",
    descriptionZh: "废土地球地图，包含圣城、生态穹顶、腐化生物和泰坦挑战。",
  },
  {
    id: "Astraeos_WP",
    displayNameZh: "繁星",
    englishName: "Astraeos",
    typeZh: "官方高级地图",
    aliasesZh: ["阿斯特瑞奥斯", "星神"],
    descriptionZh: "希腊神话风格高级地图，属于 ASA 官方支持的扩展地图。",
  },
  {
    id: "Ragnarok_WP",
    displayNameZh: "仙境",
    englishName: "Ragnarok",
    typeZh: "官方非剧情地图",
    aliasesZh: ["诸神黄昏"],
    descriptionZh: "大型开放地图，包含峡湾、沙漠、雪山、火山和多种资源区。",
  },
  {
    id: "Valguero_WP",
    displayNameZh: "瓦尔盖罗",
    englishName: "Valguero",
    typeZh: "计划/兼容地图",
    aliasesZh: ["瓦尔古罗"],
    descriptionZh: "经典扩展地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
  {
    id: "CrystalIsles_WP",
    displayNameZh: "水晶岛",
    englishName: "Crystal Isles",
    typeZh: "计划/兼容地图",
    descriptionZh: "经典扩展地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
  {
    id: "LostIsland_WP",
    displayNameZh: "失落之地",
    englishName: "Lost Island",
    typeZh: "计划/兼容地图",
    aliasesZh: ["失落之岛", "迷失岛", "失落岛"],
    descriptionZh: "经典扩展地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
  {
    id: "LostColony_WP",
    displayNameZh: "失落殖民地",
    englishName: "Lost Colony",
    typeZh: "官方剧情地图",
    aliasesZh: ["失落之地殖民地"],
    descriptionZh: "ASA 新增剧情地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
  {
    id: "Fjordur_WP",
    displayNameZh: "峡湾",
    englishName: "Fjordur",
    typeZh: "计划/兼容地图",
    aliasesZh: ["菲尤尔"],
    descriptionZh: "经典扩展地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
  {
    id: "Genesis_WP",
    displayNameZh: "创世纪：第一部",
    englishName: "Genesis: Part 1",
    typeZh: "计划/兼容地图",
    descriptionZh: "经典剧情地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
  {
    id: "Gen2_WP",
    displayNameZh: "创世纪：第二部",
    englishName: "Genesis: Part 2",
    typeZh: "计划/兼容地图",
    descriptionZh: "经典剧情地图启动名预置；如果当前服务端版本尚未发布该地图，请使用自定义地图确认。",
  },
];

export function defaultMapId() {
  return ASA_MAPS[0].id;
}

export function isKnownMap(mapId) {
  return ASA_MAPS.some((map) => map.id === mapId);
}
