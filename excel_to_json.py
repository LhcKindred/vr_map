import pandas as pd
import json
import requests
import time
import sys
import os
import math

# ==================== 配置 ====================
GAODE_AK = "4a8c03d91be21ad47bf9dfc619871b3c"          # 请替换为高德 Web 服务 AK
excel_file = 'vr_data.xlsx'
json_file = 'data.json'                  # 读取/写入同一个文件
# =============================================

def gcj02_to_bd09(lng, lat):
    """
    高精度 GCJ-02 → BD-09 转换（基于官方逆推公式）
    """
    x = lng
    y = lat
    z = math.sqrt(x * x + y * y) + 0.00002 * math.sin(y * math.pi * 3000 / 180)
    theta = math.atan2(y, x) + 0.000003 * math.cos(x * math.pi * 3000 / 180)
    bd_lng = z * math.cos(theta) + 0.0065
    bd_lat = z * math.sin(theta) + 0.006
    return bd_lng, bd_lat

def get_coordinates(address, ak):
    """高德地理编码 → BD-09"""
    url = "https://restapi.amap.com/v3/geocode/geo"
    params = {"key": ak, "address": address, "output": "JSON"}
    try:
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if data.get("status") == "1" and data.get("geocodes"):
            loc = data["geocodes"][0]["location"]
            gcj_lng, gcj_lat = map(float, loc.split(','))
            return gcj02_to_bd09(gcj_lng, gcj_lat)
        else:
            print(f"  -> 高德解析失败: {data.get('info', '未知错误')}")
            return None, None
    except Exception as e:
        print(f"  -> 请求异常: {e}")
        return None, None

def safe_load_json(path):
    """安全加载 JSON，空/损坏时返回 []"""
    if not os.path.exists(path):
        print(f"JSON 文件不存在: {path}，将新建")
        return []
    if os.path.getsize(path) == 0:
        print(f"JSON 文件为空: {path}，将初始化")
        return []

    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"JSON 解析错误: {e}（文件可能损坏），将重新创建")
        return []
    except Exception as e:
        print(f"读取 JSON 异常: {e}，将重新创建")
        return []

# ==================== 主逻辑 ====================
try:
    df = pd.read_excel(excel_file)
    print(f"读取 Excel: {excel_file}，共 {len(df)} 行")
except Exception as e:
    print(f"读取 Excel 失败: {e}")
    sys.exit(1)

# 1. 安全加载已有 JSON
all_data = safe_load_json(json_file)

# 构建快速查找结构
cities_map = {}
existing_projects = {}   # (city, district, name) -> project_obj

for city_obj in all_data:
    city_name = city_obj.get('city')
    if not city_name:
        continue
    cities_map[city_name] = city_obj
    for district_obj in city_obj.get('districts', []):
        district_name = district_obj.get('district')
        for proj in district_obj.get('projects', []):
            key = (city_name, district_name, proj.get('name'))
            existing_projects[key] = proj

print(f"已加载 {len(all_data)} 个城市，{len(existing_projects)} 个项目")

added_count = 0

for idx, row in df.iterrows():
    print(f"\n处理第 {idx+1}/{len(df)} 行 (Excel 行号: {idx+2})")

    city_name = row.get('城市')
    district_name = row.get('区县')
    project_name = row.get('项目名称')
    if not all([city_name, district_name, project_name]):
        print("  -> 缺少必要字段，跳过")
        continue

    key = (city_name, district_name, project_name)
    if key in existing_projects:
        print(f"  -> 项目已存在，跳过: {project_name}")
        continue

    # 新项目 → 高德获取坐标
    address = row.get('位置')
    if not address:
        print("  -> 位置字段为空，跳过")
        continue

    print(f"  -> 查询地址: {address}")
    time.sleep(0.5)  # 避免请求过快
    lng, lat = get_coordinates(address, GAODE_AK)
    if lng is None or lat is None:
        print(f"  -> 坐标获取失败，跳过: {project_name}")
        continue

    print(f"  -> 成功 (BD-09): lng={lng:.6f}, lat={lat:.6f}")

    # 确保城市/区县结构
    if city_name not in cities_map:
        city_obj = {"city": city_name, "districts": []}
        all_data.append(city_obj)
        cities_map[city_name] = city_obj

    city_obj = cities_map[city_name]
    district_obj = next(
        (d for d in city_obj['districts'] if d['district'] == district_name), None
    )
    if district_obj is None:
        district_obj = {"district": district_name, "projects": []}
        city_obj['districts'].append(district_obj)

    # 新项目对象
    project_obj = {
        "id": f"{city_name}-{district_name}-{idx}",
        "name": project_name,
        "url": row.get('链接', ''),
        "longitude": lng,
        "latitude": lat,
        "protectionLevel": row.get('保护级别', '')
    }
    district_obj['projects'].append(project_obj)
    existing_projects[key] = project_obj
    added_count += 1

    time.sleep(1)   # 防频率限制

# 2. 写回文件（覆盖）
try:
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)
    print(f"\n处理完成！新增 {added_count} 个项目，保存至 {json_file}")
except Exception as e:
    print(f"写入 JSON 失败: {e}")

# =============================================