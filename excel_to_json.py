import pandas as pd
import json
import requests
import time
import sys

# --- 配置 ---
# 1. 粘贴从百度地图开放平台申请的AK
BAIDU_AK = "oHfIHY7Y0xQPN25WqrZNB4jBUZZYnDNM" 
# 2. 输入的Excel文件名
excel_file = 'vr_data.xlsx'
# 3. 输出的JSON文件名
json_file = 'data_temp.json'

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
        response.raise_for_status() # 如果请求失败则引发异常
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
    
    all_data = []
    cities_map = {}

    # 遍历Excel的每一行
    for index, row in df.iterrows():
        # 加上 [index+2] 快速定位到出错的行
        print(f"\n正在处理第 {index + 1}/{len(df)} 条数据 (Excel行号: {index + 2}) ...")
        
        address_to_search = row['位置']
        print(f"  -> 正在查询地址: '{address_to_search}'")
        
        # 调用函数获取经纬度
        longitude, latitude = get_coordinates(address_to_search, BAIDU_AK)
        
        # 如果获取失败，则跳过此条数据
        if longitude is None or latitude is None:
            print(f"  -> 警告：跳过项目 '{row['项目名称']}'，因为无法获取其经纬度。")
            # continue # 跳过
        
        print(f"  -> 查询成功: 经度={longitude}, 纬度={latitude}")
        
        city_name = row['城市']
        district_name = row['区县']
        
        if city_name not in cities_map:
            city_obj = {"city": city_name, "districts": []}
            all_data.append(city_obj)
            cities_map[city_name] = city_obj
        
        current_city_obj = cities_map[city_name]
        
        district_obj = next((d for d in current_city_obj['districts'] if d['district'] == district_name), None)
        
        if district_obj is None:
            district_obj = {"district": district_name, "projects": []}
            current_city_obj['districts'].append(district_obj)
            
        project_obj = {
            "id": f"{city_name}-{district_name}-{index}",
            "name": row['项目名称'],
            "url": row['链接'],
            "longitude": longitude, # 使用API获取到的经度
            "latitude": latitude    # 使用API获取到的纬度
        }
        
        district_obj['projects'].append(project_obj)

        # 增加0.1s延时，避免请求频率过高导致被API服务器限制
        time.sleep(0.3)

    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 转换完成！已将数据从 {excel_file} 转换并保存到 {json_file}")

except FileNotFoundError:
    print(f"错误：找不到文件 '{excel_file}'。")
except KeyError as e:
    print(f"错误：Excel文件中缺少必需的列名: {e}。请检查列名是否为 '城市', '区县', '项目名称', '链接', '位置'")
except Exception as e:
    print(f"发生未知错误: {e}")