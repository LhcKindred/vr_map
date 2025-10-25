document.addEventListener('DOMContentLoaded', function() {
    const BAIDU_MAP_AK = '1ufK1yIu2Lu9KhwzciQAGjGNqOu7iKcE';
    const CITY_COLORS = { '太原市': '#40C4FF', '吕梁市': '#FFD700', '晋中市': '#81C784' };
    const DEFAULT_COLOR = '#E0E0E0';

    // --- 全局变量 ---
    const mapContainer = document.getElementById('map-container');
    const treeContainer = document.getElementById('tree-container');
    const sidebar = document.getElementById('tree-menu');
    const toggleButton = document.querySelector('.toggle-sidebar');
    let map, allMapMarkers = new Map(), allData = [], virtualScroller, flatTreeData = [];

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

            allData = validateAndCleanData(await (await fetch('data.json')).json());
            flatTreeData = flattenTreeData(allData);
            setupVirtualScroll();
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

    function flattenTreeData(data) {
        const flatData = [];
        const totalProjectCount = data.reduce((sum, city) => sum + city.districts.reduce((sum, d) => sum + d.projects.length, 0), 0);
        flatData.push({ type: 'province', id: 'shanxi', name: '山西省', projectCount: totalProjectCount, expanded: true, level: 0, visible: true });

        data.forEach(city => {
            const cityProjectCount = city.districts.reduce((sum, d) => sum + d.projects.length, 0);
            flatData.push({ type: 'city', id: city.city, name: city.city, projectCount: cityProjectCount, expanded: false, level: 1, parentId: 'shanxi', visible: true });
            city.districts.forEach(district => {
                flatData.push({ type: 'district', id: `${city.city}-${district.district}`, name: district.district, projectCount: district.projects.length, expanded: false, level: 2, parentId: city.city, visible: false });
                district.projects.forEach(project => {
                    flatData.push({ type: 'project', id: project.id, name: project.name, url: project.url, level: 3, parentId: `${city.city}-${district.district}`, visible: false });
                });
            });
        });
        return flatData;
    }

    function setupVirtualScroll() {
        treeContainer.innerHTML = '';
        if (!window.VirtualScroller) {
            console.warn('【调试】VirtualScroller 未加载，降级到非虚拟模式');
            buildTreeMenu();
            return;
        }
        virtualScroller = new VirtualScroller(treeContainer, {
            items: flatTreeData.filter(item => item.visible),
            itemHeight: 32,
            renderItem: (item) => {
                const div = document.createElement('div');
                div.className = `${item.type}-item`;
                div.dataset.itemId = item.id;
                div.style.paddingLeft = `${item.level * 15}px`;
                if (item.type !== 'project') {
                    div.classList.toggle('expanded', item.expanded);
                    const title = document.createElement('div');
                    title.className = `${item.type}-title clickable-title`;
                    title.innerHTML = `<span>${item.name}</span><span class="project-count">${item.projectCount || ''}</span>`;
                    div.appendChild(title);
                } else {
                    div.innerHTML = `<a href="${item.url}" data-project-id="${item.id}">${item.name}</a>`;
                }
                return div;
            },
            overscan: 5
        });
    }

    function buildTreeMenu() {
        const rootUl = document.createElement('ul');
        rootUl.className = 'tree-root';
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
        treeContainer.innerHTML = '';
        treeContainer.appendChild(rootUl);
    }

    function buildNode(type, id, name, projectCount, children = [], expanded = false, url = '') {
        const li = document.createElement('li');
        li.className = `${type}-item${expanded ? ' expanded' : ''}`;
        li.innerHTML = type === 'project'
            ? `<a href="${url}" data-project-id="${id}">${name}</a>`
            : `<div class="${type}-title clickable-title"><span>${name}</span><span class="project-count">${projectCount || ''}</span></div>`;
        if (children.length) {
            const ul = document.createElement('ul');
            ul.className = `${type === 'province' ? 'cities' : type === 'city' ? 'districts' : 'projects'}-list`;
            children.forEach(child => {
                ul.appendChild(buildNode(child.type, child.id, child.name, child.projectCount, child.children, false, child.url || ''));
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

    // 【新需求】获取节点下所有项目 ID
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
        const selectors = {
            allLis: () => treeContainer.querySelectorAll('li'),
            projects: () => treeContainer.querySelectorAll('.project-item'),
            provinceCity: () => treeContainer.querySelectorAll('.province-item, .city-item'),
            province: () => treeContainer.querySelector('.province-item')
        };

        treeContainer.addEventListener('click', function(event) {
            const target = event.target;
            if (target.tagName === 'A' && target.dataset.projectId) {
                event.preventDefault();
                const projectId = target.dataset.projectId;
                const marker = allMapMarkers.get(projectId);
                // 【修复】确保首次点击触发 flyTo，立即关闭当前 infoWindow
                if (marker && map) {
                    // 【新需求】点击项目时只显示该项目的标记点
                    // updateMapMarkersVisibility([projectId]);
                    // 【修复】关闭当前 infoWindow
                    if (map.getInfoWindow()) {
                        map.closeInfoWindow();
                        console.log('【调试】关闭当前 infoWindow');
                    }
                    const infoWindowContent = `<div><b>${target.textContent}</b><p><a href="${target.href}" rel="noopener noreferrer">点击进入720全景</a></p></div>`;
                    console.log('【调试】点击项目:', target.textContent, 'ID:', projectId, 'Marker:', !!marker, 'Map:', !!map);
                    // 延迟执行 flyTo，确保地图渲染完成
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
                const parent = clickableTitle.closest(virtualScroller ? '[data-item-id]' : 'li');
                if (!parent) return;

                if (virtualScroller) {
                    const item = flatTreeData.find(i => i.id === parent.dataset.itemId);
                    if (!item || item.type === 'project') return;

                    const isNowExpanded = !item.expanded;
                    item.expanded = isNowExpanded;
                    if (!isNowExpanded) resetChildrenExpanded(item.id);

                    if (isNowExpanded && (item.type === 'city' || item.type === 'district')) {
                        flatTreeData.forEach(other => {
                            if (other.parentId === item.parentId && other.id !== item.id && other.expanded) {
                                other.expanded = false;
                                updateChildrenVisibility(other.id, false, true);
                                resetChildrenExpanded(other.id);
                            }
                        });
                    }

                    updateChildrenVisibility(item.id, isNowExpanded, true);
                    virtualScroller.items = flatTreeData.filter(i => i.visible);
                    virtualScroller.update();
                    // 【新需求】更新地图标记点，仅显示当前节点下的项目
                    const projectIds = getChildProjectIds(item.id);
                    updateMapMarkersVisibility(projectIds);
                    console.log('【调试】虚拟模式点击:', item.name, '类型:', item.type, '展开:', isNowExpanded, '显示项目数:', projectIds.length);
                } else {
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
                    // 【新需求】更新地图标记点，仅显示当前节点下的项目
                    const itemId = parent.dataset.itemId || parent.querySelector('.clickable-title span').textContent;
                    const item = flatTreeData.find(i => i.id === itemId || i.name === itemId);
                    if (item) {
                        const projectIds = getChildProjectIds(item.id);
                        updateMapMarkersVisibility(projectIds);
                        console.log('【调试】非虚拟模式点击:', item.name, '类型:', item.type, '展开:', !isExpanded, '显示项目数:', projectIds.length);
                    }
                }
            }
        });

        function updateChildrenVisibility(parentId, visible, isRecursive) {
            flatTreeData.forEach(item => {
                if (item.parentId === parentId) {
                    item.visible = visible;
                    if (isRecursive) updateChildrenVisibility(item.id, visible && item.expanded, true);
                }
            });
        }

        function resetChildrenExpanded(parentId) {
            flatTreeData.forEach(item => {
                if (item.parentId === parentId) {
                    item.expanded = false;
                    resetChildrenExpanded(item.id);
                }
            });
        }

        function filterTree(searchTerm) {
            const visibleIds = [];
            const noResults = document.querySelector('.no-results');
            if (noResults) noResults.remove();

            const allLis = selectors.allLis();
            const projects = selectors.projects();
            const provinceCity = selectors.provinceCity();
            const province = selectors.province();

            if (searchTerm === '') {
                if (virtualScroller) {
                    flatTreeData.forEach(item => {
                        item.expanded = item.type === 'province';
                        item.visible = item.type === 'province' || item.type === 'city';
                        if (item.type === 'district' || item.type === 'project') item.visible = false;
                    });
                    virtualScroller.items = flatTreeData.filter(item => item.visible);
                    virtualScroller.update();
                } else {
                    allLis.forEach(li => li.style.display = 'none');
                    provinceCity.forEach(li => {
                        li.style.display = 'block';
                        li.classList.remove('expanded');
                        const subList = li.querySelector('ul');
                        if (subList) subList.querySelectorAll('li').forEach(subLi => subLi.style.display = 'none');
                    });
                    if (province) province.classList.add('expanded');
                }
                visibleIds.push(...flatTreeData.filter(item => item.type === 'project').map(item => item.id));
            } else {
                const foundProjectIds = new Set();
                allData.forEach(city => city.districts.forEach(d => d.projects.forEach(p => {
                    if (p.name.toLowerCase().includes(searchTerm)) foundProjectIds.add(p.id);
                })));
                visibleIds.push(...foundProjectIds);

                if (virtualScroller) {
                    flatTreeData.forEach(item => {
                        item.visible = false;
                        item.expanded = item.type === 'province';
                    });
                    const visibleParents = new Set();
                    flatTreeData.forEach(item => {
                        if (item.type === 'project' && foundProjectIds.has(item.id)) {
                            item.visible = true;
                            let parentId = item.parentId;
                            while (parentId) {
                                visibleParents.add(parentId);
                                const parent = flatTreeData.find(p => p.id === parentId);
                                parentId = parent?.parentId;
                            }
                        }
                    });
                    flatTreeData.forEach(item => {
                        if (item.type !== 'project' && visibleParents.has(item.id)) {
                            item.visible = true;
                            item.expanded = true;
                        }
                    });
                    const provinceItem = flatTreeData.find(i => i.type === 'province');
                    if (provinceItem && visibleParents.size) {
                        provinceItem.visible = true;
                        provinceItem.expanded = true;
                    }
                    virtualScroller.items = flatTreeData.filter(item => item.visible);
                    virtualScroller.update();
                } else {
                    allLis.forEach(li => li.style.display = 'none');
                    let hasResults = false;
                    projects.forEach(projectLi => {
                        const a = projectLi.querySelector('a');
                        if (a?.textContent.toLowerCase().includes(searchTerm)) {
                            hasResults = true;
                            projectLi.style.display = 'block';
                            let parent = projectLi.closest('.district-item');
                            if (parent) {
                                parent.style.display = 'block';
                                parent.classList.add('expanded');
                                parent = parent.closest('.city-item');
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
                }
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

        searchBox.addEventListener('input', function() {
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