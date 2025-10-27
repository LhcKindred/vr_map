import pandas as pd
import json

def update_json_with_protection_levels(excel_path, json_path, output_path=None):
    """
    更新 JSON 文件中的项目，添加保护级别字段。
    
    Args:
        excel_path (str): Excel 文件路径 (vr_data.xlsx)
        json_path (str): JSON 文件路径 (data.json)
        output_path (str, optional): 输出更新 JSON 的路径。如果 None，返回字符串。
    
    Returns:
        str: 更新后的 JSON 字符串（如果无 output_path）。
    
    Raises:
        ValueError: 如果文件或列缺失。
    """
    try:
        # 步骤1: 读取 Excel，跳过 header 行（row1 是标题）
        df = pd.read_excel(excel_path, sheet_name='Sheet1', header=0)
        
        # 检查必要列
        required_cols = ['城市', '区县', '项目名称', '保护级别']
        if not all(col in df.columns for col in required_cols):
            raise ValueError(f"Excel 缺少必要列: {required_cols}")
        
        # 步骤2: 创建映射字典，键: (城市, 区县, 项目名称) -> 保护级别
        mapping = {}
        for _, row in df.iterrows():
            key = (row['城市'], row['区县'], row['项目名称'])
            mapping[key] = row['保护级别']
        
        # 步骤3: 读取 JSON
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 步骤4: 遍历 JSON 并更新
        updated_count = 0
        for city in data:
            city_name = city.get('city')
            for district in city.get('districts', []):
                district_name = district.get('district')
                for project in district.get('projects', []):
                    project_name = project.get('name')
                    key = (city_name, district_name, project_name)
                    if key in mapping:
                        project['protectionLevel'] = mapping[key]
                        updated_count += 1
        
        # 步骤5: 输出
        updated_json = json.dumps(data, ensure_ascii=False, indent=4)
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(updated_json)
            print(f"更新完成: {updated_count} 个项目。输出文件: {output_path}")
            return None
        else:
            print(f"更新完成: {updated_count} 个项目。")
            return updated_json
    
    except FileNotFoundError as e:
        raise ValueError(f"文件不存在: {e}")
    except Exception as e:
        raise ValueError(f"处理失败: {str(e)}")

# 示例调用
updated = update_json_with_protection_levels('vr_data.xlsx', 'data.json', 'updated_data.json')
# 或 print(update_json_with_protection_levels('vr_data.xlsx', 'data.json'))