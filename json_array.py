import json
with open('data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
# 遍历所有projects，转url为数组
for city in data:
    for district in city['districts']:
        for project in district['projects']:
            if isinstance(project['url'], str):
                project['url'] = [u.strip() for u in project['url'].split('\n') if u.strip()]
with open('data_new.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)