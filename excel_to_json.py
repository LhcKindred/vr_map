import pandas as pd
import json
import requests
import time
import sys
import os  # 新增：用于检查文件是否存在

# --- 配置 ---
# 1. 粘贴从百度地图开放平台申请的AK
BAIDU_AK = "oHfIHY7Y0xQPN25WqrZNB4jBUZZYnDNM" 
# 2. 输入的Excel文件名
excel_file = 'vr_data.xlsx'
# 3. 输入/输出的JSON文件名（读取并更新同一个文件）
json_file = 'data.json'

def get_coordinates(address, ak):
    """
    使用百度地图地理编码API将地址转换为经纬度
    """
    url = "http://api.map.baidu.com/geocoding/v3/"
    params = {
        "address": address,
        "output": "json",
        "ak": ak
    }
    try:
        response = requests.get(url, params=params)
        response.raise_for_status()  # 如果请求失败则引发异常
        data = response.json()
        
        # 检查API返回的状态
        if data.get("status") == 0:
            location = data["result"]["location"]
            # 百度地图返回的是 lng(经度), lat(纬度)
            return location["lng"], location["lat"]
        else:
            print(f"  -> 地址 '{address}' 解析失败: {data.get('msg', '未知错误')}")
            return None, None
            
    except requests.exceptions.RequestException as e:
        print(f"  -> 网络请求错误: {e}")
        return None, None
    except Exception as e:
        print(f"  -> 解析地址 '{address}' 时发生未知错误: {e}")
        return None, None

# --- 主逻辑 ---
try:
    df = pd.read_excel(excel_file)
    print(f"成功读取Excel文件: {excel_file}，共 {len(df)} 条数据。")
    
    # 步骤1: 加载现有的JSON（如果存在），否则从空开始
    all_data = []
    cities_map = {}
    existing_projects = {}  # 映射：(city, district, name) -> project_obj（用于检查存在）
    
    if os.path.exists(json_file):
        with open(json_file, 'r', encoding='utf-8') as f:
            all_data = json.load(f)
        print(f"成功加载现有JSON文件: {json_file}，共 {len(all_data)} 个城市。")
        
        # 构建cities_map和existing_projects
        for city_obj in all_data:
            city_name = city_obj['city']
            cities_map[city_name] = city_obj
            for district_obj in city_obj['districts']:
                district_name = district_obj['district']
                for project in district_obj['projects']:
                    key = (city_name, district_name, project['name'])
                    existing_projects[key] = project
    else:
        print(f"JSON文件 {json_file} 不存在，将从头创建。")

    # 步骤2: 遍历Excel的每一行，只添加不存在的项目
    added_count = 0
    for index, row in df.iterrows():
        print(f"\n正在处理第 {index + 1}/{len(df)} 条数据 (Excel行号: {index + 2}) ...")
        
        city_name = row['城市']
        district_name = row['区县']
        project_name = row['项目名称']
        
        key = (city_name, district_name, project_name)
        
        if key in existing_projects:
            print(f"  -> 项目 '{project_name}' 已存在于JSON中，跳过（保留原有数据）。")
            continue  # 跳过，已存在的不变
        
        # 新项目：获取经纬度
        address_to_search = row['位置']
        print(f"  -> 正在查询新地址: '{address_to_search}'")
        
        longitude, latitude = get_coordinates(address_to_search, BAIDU_AK)
        
        if longitude is None or latitude is None:
            print(f"  -> 警告：跳过新项目 '{project_name}'，因为无法获取其经纬度。")
            continue
        
        print(f"  -> 查询成功: 经度={longitude}, 纬度={latitude}")
        
        # 确保城市和区县存在
        if city_name not in cities_map:
            city_obj = {"city": city_name, "districts": []}
            all_data.append(city_obj)
            cities_map[city_name] = city_obj
        
        current_city_obj = cities_map[city_name]
        
        district_obj = next((d for d in current_city_obj['districts'] if d['district'] == district_name), None)
        
        if district_obj is None:
            district_obj = {"district": district_name, "projects": []}
            current_city_obj['districts'].append(district_obj)
            
        # 创建新project_obj
        project_obj = {
            "id": f"{city_name}-{district_name}-{index}",
            "name": project_name,
            "url": row['链接'],
            "longitude": longitude,
            "latitude": latitude,
            "protectionLevel": row['保护级别']
        }
        
        district_obj['projects'].append(project_obj)
        existing_projects[key] = project_obj  # 更新映射
        added_count += 1

        # 增加延时，避免API限频
        time.sleep(0.3)

    # 步骤3: 保存更新后的JSON（覆盖原文件）
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 处理完成！添加了 {added_count} 个新项目。更新后的JSON保存到 {json_file}")

except FileNotFoundError as e:
    print(f"错误：找不到文件 - {e}")
except KeyError as e:
    print(f"错误：Excel文件中缺少必需的列名: {e}。请检查列名是否为 '城市', '区县', '项目名称', '链接', '位置', '保护级别'")
except Exception as e:
    print(f"发生未知错误: {e}")