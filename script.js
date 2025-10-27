document.addEventListener('DOMContentLoaded', function () {
    const BAIDU_MAP_AK = '1ufK1yIu2Lu9KhwzciQAGjGNqOu7iKcE';
    const CITY_COLORS = { '太原市': '#40C4FF', '吕梁市': '#FFD700', '晋中市': '#81C784' };
    const DEFAULT_COLOR = '#E0E0E0';

    // --- 全局变量 ---
    const mapContainer = document.getElementById('map-container');
    const treeContainer = document.getElementById('tree-container');
    const sidebar = document.getElementById('tree-menu');
    const toggleButton = document.querySelector('.toggle-sidebar');
    let map, allMapMarkers = new Map(), allData = [], flatTreeData = [];
    let mode = 'geo'; // 默认地理模式
    const LEVELS = ['国保', '省保', '市保', '县保', '未定级'];

    // --- 侧边栏切换 ---
    toggleButton.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        toggleButton.textContent = sidebar.classList.contains('active') ? '✕' : '☰';
        toggleButton.setAttribute('aria-label', sidebar.classList.contains('active') ? '关闭侧边栏' : '打开侧边栏');
    });

    // --- 初始化 ---
    async function initialize() {
        if (!mapContainer || !treeContainer || !sidebar || !toggleButton) {
            console.error('初始化失败：缺少核心DOM元素');
            return;
        }
        try {
            await loadBMap();
            map = new BMapGL.Map('map-container');
            map.centerAndZoom(new BMapGL.Point(112.55, 37.87), 8);
            map.enableScrollWheelZoom(true);
            map.setMapType(BMAP_EARTH_MAP);

            allData = validateAndCleanData(await (await fetch('data.json')).json().catch(() => {
                console.error('【调试】data.json 加载失败');
                return [];
            }));
            if (!allData.length) {
                throw new Error('data.json 为空或无效');
            }
            flatTreeData = buildFlatTreeData(mode);
            buildTreeMenu();
            addMapMarkers();
            setupInteractions();

            updateMapMarkersVisibility(flatTreeData.filter(item => item.type === 'project').map(item => item.id));
            document.querySelectorAll('.loading').forEach(el => el.remove());
            console.log('【调试】初始化完成');
        } catch (error) {
            console.error('初始化失败:', error);
            treeContainer.innerHTML = `<p style="color: red;">加载失败：${error.message}</p>`;
        }
    }

    function validateAndCleanData(data) {
        if (!Array.isArray(data)) throw new Error('数据必须是数组');
        const warnings = [];
        data.forEach((city, cityIndex) => {
            if (!city.city || !Array.isArray(city.districts)) {
                throw new Error(`城市数据格式无效: index ${cityIndex}`);
            }
            city.districts.forEach((district, districtIndex) => {
                if (!district.district || !Array.isArray(district.projects)) {
                    throw new Error(`区县数据无效: ${city.city} -> index ${districtIndex}`);
                }
                for (let i = district.projects.length - 1; i >= 0; i--) {
                    const project = district.projects[i];
                    if (!project.id || !project.name || !project.url || isNaN(project.longitude) || isNaN(project.latitude)) {
                        warnings.push(`项目数据无效或坐标缺失，已跳过: ${project.id || project.name || '未知项目'}`);
                        district.projects.splice(i, 1);
                    } else if (!project.protectionLevel) {
                        console.warn(`项目无保护级别: ${project.id}, 默认 '未定级'`);
                        project.protectionLevel = '未定级';
                    }
                }
            });
        });
        if (warnings.length) console.warn('数据验证问题:\n- ' + warnings.join('\n- '));
        return data;
    }

    function loadBMap() {
        return new Promise((resolve, reject) => {
            if (window.BMapGL) return resolve();
            const script = document.createElement('script');
            const callbackName = 'initBMap_' + Math.random().toString(36).slice(2);
            script.src = `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=${BAIDU_MAP_AK}&callback=${callbackName}`;
            script.onerror = () => reject(new Error('百度地图 API 加载失败'));
            document.body.appendChild(script);
            window[callbackName] = resolve;
        });
    }

    function buildFlatTreeData(mode) {
        const flatData = [];
        let totalProjectCount = 0;

        if (mode === 'geo') {
            totalProjectCount = allData.reduce((sum, city) => sum + city.districts.reduce((sum, d) => sum + d.projects.length, 0), 0);
            flatData.push({ type: 'province', id: 'shanxi', name: '山西省', projectCount: totalProjectCount, expanded: true, level: 0, visible: true });

            allData.forEach(city => {
                const cityProjectCount = city.districts.reduce((sum, d) => sum + d.projects.length, 0);
                flatData.push({ type: 'city', id: city.city, name: city.city, projectCount: cityProjectCount, expanded: false, level: 1, parentId: 'shanxi', visible: true });
                city.districts.forEach(district => {
                    flatData.push({ type: 'district', id: `${city.city}-${district.district}`, name: district.district, projectCount: district.projects.length, expanded: false, level: 2, parentId: city.city, visible: false });
                    district.projects.forEach(project => {
                        flatData.push({ type: 'project', id: project.id, name: project.name, url: project.url, level: 3, parentId: `${city.city}-${district.district}`, visible: false });
                    });
                });
            });
        } else { // 'level' 模式
            const levelGroups = new Map(LEVELS.map(l => [l, []]));
            allData.forEach(city => {
                city.districts.forEach(district => {
                    district.projects.forEach(project => {
                        const level = project.protectionLevel || '未定级';
                        if (levelGroups.has(level)) {
                            levelGroups.get(level).push(project);
                        }
                        totalProjectCount++;
                    });
                });
            });

            flatData.push({ type: 'province', id: 'shanxi', name: '山西省', projectCount: totalProjectCount, expanded: true, level: 0, visible: true });

            LEVELS.forEach(levelName => {
                const projects = levelGroups.get(levelName) || [];
                console.log(`【调试】级别 ${levelName}: ${projects.length} 个项目`);
                const count = projects.length;
                const categoryId = `level-${levelName.toLowerCase().slice(0, 3)}`;
                flatData.push({ type: 'level-category', id: categoryId, name: levelName, projectCount: count, expanded: false, level: 1, parentId: 'shanxi', visible: true }); // 默认折叠
                projects.forEach(project => {
                    flatData.push({ type: 'project', id: project.id, name: project.name, url: project.url, level: 2, parentId: categoryId, visible: false }); // 项目默认隐藏
                });
            });
        }

        return flatData;
    }

    function buildTreeMenu() {
        const rootUl = document.createElement('ul');
        rootUl.className = 'tree-root';
        if (mode === 'geo') {
            const citiesData = allData.map(city => ({
                type: 'city',
                id: city.city,
                name: city.city,
                projectCount: city.districts.reduce((sum, d) => sum + d.projects.length, 0),
                children: city.districts.map(district => ({
                    type: 'district',
                    id: `${city.city}-${district.district}`,
                    name: district.district,
                    projectCount: district.projects.length,
                    children: district.projects.map(project => ({
                        type: 'project',
                        id: project.id,
                        name: project.name,
                        url: project.url
                    }))
                }))
            }));
            rootUl.appendChild(buildNode('province', 'shanxi', '山西省', allData.reduce((sum, city) => sum + city.districts.reduce((sum, d) => sum + d.projects.length, 0), 0), citiesData, true));
        } else {
            const levelGroups = new Map(LEVELS.map(l => [l, []]));
            allData.forEach(city => {
                city.districts.forEach(district => {
                    district.projects.forEach(project => {
                        const level = project.protectionLevel || '未定级';
                        if (levelGroups.has(level)) levelGroups.get(level).push(project);
                    });
                });
            });
            const levelData = LEVELS.map(level => ({
                type: 'level-category',
                id: `level-${level.toLowerCase().slice(0, 3)}`,
                name: level,
                projectCount: levelGroups.get(level).length,
                children: levelGroups.get(level).map(project => ({
                    type: 'project',
                    id: project.id,
                    name: project.name,
                    url: project.url
                })),
                expanded: false // 默认折叠
            }));
            rootUl.appendChild(buildNode('province', 'shanxi', '山西省', allData.reduce((sum, city) => sum + city.districts.reduce((sum, d) => sum + d.projects.length, 0), 0), levelData, true));
        }
        treeContainer.innerHTML = '';
        treeContainer.appendChild(rootUl);

        // 默认折叠级别模式下的子项目
        if (mode === 'level') {
            treeContainer.querySelectorAll('.level-category-item').forEach(li => {
                li.classList.remove('expanded'); // 确保折叠
                const subList = li.querySelector('ul');
                if (subList) {
                    subList.querySelectorAll('li').forEach(subLi => {
                        subLi.style.display = 'none'; // 隐藏项目
                    });
                }
            });
        }
    }

    function buildNode(type, id, name, projectCount, children = [], expanded = false, url = '') {
        const li = document.createElement('li');
        li.className = `${type}-item${expanded ? ' expanded' : ''}`;
        li.dataset.itemId = id;
        li.innerHTML = type === 'project'
            ? `<a href="${url}" data-project-id="${id}">${name}</a>`
            : `<div class="${type === 'level-category' ? 'level-category-title' : `${type}-title`} clickable-title"><span>${name}</span><span class="project-count">${projectCount || ''}</span></div>`;
        if (children.length) {
            const ul = document.createElement('ul');
            ul.className = `${type === 'province' ? 'cities' : type === 'city' ? 'districts' : type === 'level-category' ? 'projects' : 'projects'}-list`;
            children.forEach(child => {
                ul.appendChild(buildNode(child.type, child.id, child.name, child.projectCount, child.children, child.expanded || false, child.url || ''));
            });
            li.appendChild(ul);
        }
        return li;
    }

    function addMapMarkers() {
        let markerCount = 0;
        allData.forEach(cityData => {
            const color = (CITY_COLORS[cityData.city] || DEFAULT_COLOR).replace('#', '%23');
            const customIcon = new BMapGL.Icon(
                `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/><circle fill="rgba(25, 35, 50, 0.8)" cx="12" cy="9.5" r="1.5"/></svg>`,
                new BMapGL.Size(28, 28), { anchor: new BMapGL.Size(14, 28) }
            );
            cityData.districts.forEach(districtData => {
                districtData.projects.forEach(project => {
                    try {
                        const point = new BMapGL.Point(project.longitude, project.latitude);
                        const marker = new BMapGL.Marker(point, { enableDragging: false, icon: customIcon });
                        map.addOverlay(marker);
                        const content = `<div><b>${project.name}</b><p><a href="${project.url}" rel="noopener noreferrer">点击进入720全景</a></p></div>`;
                        marker.addEventListener("click", () => map.openInfoWindow(new BMapGL.InfoWindow(content), point));
                        allMapMarkers.set(project.id, marker);
                        markerCount++;
                    } catch (err) {
                        console.warn('添加标记点失败:', project.id, err);
                    }
                });
            });
        });
        console.log('【调试】地图标记点添加:', markerCount);
    }

    function getChildProjectIds(parentId) {
        const projectIds = [];
        function collectProjects(id) {
            flatTreeData.forEach(item => {
                if (item.parentId === id) {
                    if (item.type === 'project') {
                        projectIds.push(item.id);
                    } else {
                        collectProjects(item.id);
                    }
                }
            });
        }
        if (parentId === 'shanxi') {
            return flatTreeData.filter(item => item.type === 'project').map(item => item.id);
        }
        collectProjects(parentId);
        return projectIds;
    }

    function setupInteractions() {
        const searchBox = document.getElementById('search-box');
        const modeToggle = document.getElementById('mode-toggle');
        const selectors = {
            allLis: () => treeContainer.querySelectorAll('li'),
            projects: () => treeContainer.querySelectorAll('.project-item'),
            provinceCity: () => treeContainer.querySelectorAll('.province-item, .city-item'),
            province: () => treeContainer.querySelector('.province-item')
        };

        if (modeToggle) {
            modeToggle.addEventListener('click', () => {
                console.log('【调试】点击模式切换按钮, 当前 mode:', mode);
                mode = mode === 'geo' ? 'level' : 'geo';
                console.log('【调试】切换后 mode:', mode);
                modeToggle.textContent = mode === 'geo' ? '切换到级别模式' : '切换到地理模式';
                flatTreeData = buildFlatTreeData(mode);
                console.log('【调试】flatTreeData:', flatTreeData);
                buildTreeMenu();
                const allProjectIds = flatTreeData.filter(item => item.type === 'project').map(item => item.id);
                console.log('【调试】切换模式后显示项目:', allProjectIds.length);
                updateMapMarkersVisibility(allProjectIds);
                searchBox.value = '';
                filterTree('');
            });
        } else {
            console.warn('【调试】未找到模式切换按钮');
        }

        treeContainer.addEventListener('click', function (event) {
            const target = event.target;
            if (target.tagName === 'A' && target.dataset.projectId) {
                event.preventDefault();
                const projectId = target.dataset.projectId;
                const marker = allMapMarkers.get(projectId);
                if (map && marker) {
                    if (map.getInfoWindow()) {
                        map.closeInfoWindow();
                        console.log('【调试】关闭当前 infoWindow');
                    }
                    const infoWindowContent = `<div><b>${target.textContent}</b><p><a href="${target.href}" rel="noopener noreferrer">点击进入720全景</a></p></div>`;
                    console.log('【调试】点击项目:', target.textContent, 'ID:', projectId, 'Marker:', !!marker, 'Map:', !!map);
                    const executeFlyTo = () => {
                        try {
                            map.flyTo(marker.getPosition(), 17, { duration: 800, pitch: 45 });
                            map.addEventListener('moveend', () => {
                                map.openInfoWindow(new BMapGL.InfoWindow(infoWindowContent), marker.getPosition());
                                console.log('【调试】打开新 infoWindow:', target.textContent);
                                map.removeEventListener('moveend', arguments.callee);
                            });
                        } catch (err) {
                            console.error('【调试】flyTo 执行失败:', err);
                        }
                    };
                    setTimeout(executeFlyTo, 100);
                } else {
                    console.error('【调试】点击失败: 地图或标记未准备好', { projectId, markerExists: !!marker, mapExists: !!map });
                }
                return;
            }

            const clickableTitle = target.closest('.clickable-title');
            if (clickableTitle) {
                const parent = clickableTitle.closest('li');
                if (!parent) return;

                const isExpanded = parent.classList.contains('expanded');
                if (!isExpanded) {
                    const parentUl = parent.parentElement;
                    parentUl.querySelectorAll(`.${parent.className.split(' ')[0]}.expanded`).forEach(el => {
                        el.classList.remove('expanded');
                        el.querySelectorAll('li').forEach(subLi => subLi.style.display = 'none');
                        el.querySelectorAll('.expanded').forEach(subEl => subEl.classList.remove('expanded'));
                    });
                }
                parent.classList.toggle('expanded');
                const subList = parent.querySelector('ul');
                if (subList) {
                    subList.querySelectorAll('li').forEach(subLi => {
                        subLi.style.display = isExpanded ? 'none' : 'block';
                        subLi.querySelectorAll('.expanded').forEach(subSubEl => subSubEl.classList.remove('expanded'));
                        subLi.querySelectorAll('ul li').forEach(subSubLi => subSubLi.style.display = 'none');
                    });
                }
                const itemId = parent.dataset.itemId || parent.querySelector('.clickable-title span').textContent;
                const item = flatTreeData.find(i => i.id === itemId || i.name === itemId);
                if (item) {
                    const projectIds = getChildProjectIds(item.id);
                    updateMapMarkersVisibility(projectIds);
                    console.log('【调试】点击:', item.name, '类型:', item.type, '展开:', !isExpanded, '显示项目数:', projectIds.length);
                }
            }
        });

        function filterTree(searchTerm) {
            const visibleIds = [];
            const noResults = document.querySelector('.no-results');
            if (noResults) noResults.remove();

            const allLis = selectors.allLis();
            const projects = selectors.projects();
            const provinceCity = selectors.provinceCity();
            const province = selectors.province();

            if (searchTerm === '') {
                allLis.forEach(li => li.style.display = 'none');
                provinceCity.forEach(li => {
                    li.style.display = 'block';
                    li.classList.remove('expanded');
                    const subList = li.querySelector('ul');
                    if (subList) subList.querySelectorAll('li').forEach(subLi => subLi.style.display = 'none');
                });
                if (province) province.classList.add('expanded');
                if (mode === 'level') {
                    treeContainer.querySelectorAll('.level-category-item').forEach(li => {
                        li.style.display = 'block';
                        li.classList.remove('expanded'); // 默认折叠
                        const subList = li.querySelector('ul');
                        if (subList) subList.querySelectorAll('li').forEach(subLi => subLi.style.display = 'none');
                    });
                }
                visibleIds.push(...flatTreeData.filter(item => item.type === 'project').map(item => item.id));
            } else {
                const foundProjectIds = new Set();
                allData.forEach(city => city.districts.forEach(d => d.projects.forEach(p => {
                    if (p.name.toLowerCase().includes(searchTerm)) foundProjectIds.add(p.id);
                })));
                visibleIds.push(...foundProjectIds);

                allLis.forEach(li => li.style.display = 'none');
                let hasResults = false;
                projects.forEach(projectLi => {
                    const a = projectLi.querySelector('a');
                    if (a?.textContent.toLowerCase().includes(searchTerm)) {
                        hasResults = true;
                        projectLi.style.display = 'block';
                        let parent = projectLi.closest('.district-item, .level-category-item');
                        if (parent) {
                            parent.style.display = 'block';
                            parent.classList.add('expanded'); // 搜索时展开匹配类别
                            const subList = parent.querySelector('ul');
                            if (subList) subList.querySelectorAll('li').forEach(subLi => subLi.style.display = 'none');
                            projectLi.style.display = 'block';
                            parent = parent.closest('.city-item, .province-item');
                            if (parent) {
                                parent.style.display = 'block';
                                parent.classList.add('expanded');
                                parent = parent.closest('.province-item');
                                if (parent) parent.style.display = 'block';
                            }
                        }
                    }
                });
                if (!hasResults) console.log('【调试】搜索无结果:', searchTerm);

                if (foundProjectIds.size === 0 && searchTerm) {
                    const p = document.createElement('p');
                    p.className = 'no-results';
                    p.style.cssText = 'color: #ffd700; text-align: center; padding: 10px;';
                    p.textContent = '无匹配结果';
                    treeContainer.appendChild(p);
                }
            }
            updateMapMarkersVisibility(visibleIds);
        }

        searchBox.addEventListener('input', function () {
            setTimeout(() => filterTree(this.value.trim().toLowerCase()), 300);
        });
    }

    function updateMapMarkersVisibility(visibleIds) {
        const visibleIdSet = new Set(visibleIds);
        allMapMarkers.forEach((marker, id) => marker[visibleIdSet.has(id) || (!document.getElementById('search-box').value.trim() && !visibleIds.length) ? 'show' : 'hide']());
        console.log('【调试】更新标记点显隐:', visibleIdSet.size);
    }

    initialize();
});