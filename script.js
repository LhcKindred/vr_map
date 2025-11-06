document.addEventListener('DOMContentLoaded', function () {
    const BAIDU_MAP_AK = '1ufK1yIu2Lu9KhwzciQAGjGNqOu7iKcE';
    const CITY_COLORS = { '太原市': '#40C4FF', '吕梁市': '#FFD700', '晋中市': '#81C784', '长治市': '#BA68C8', '运城市': '#FF8A65', '大同市': '#4DB6AC', '阳泉市': '#FFB74D', '朔州市': '#A1887F', '忻州市': '#90A4AE', '临汾市': '#F06292', '晋城市': '#64b605ff' };
    const DEFAULT_COLOR = '#E0E0E0';

    // --- 全局变量 ---
    const mapContainer = document.getElementById('map-container');
    const treeContainer = document.getElementById('tree-container');
    const sidebar = document.getElementById('tree-menu');
    const toggleButton = document.querySelector('.toggle-sidebar');
    let map, allMapMarkers = new Map(), allData = [], flatTreeData = [];
    let mode = 'geo'; // 默认地理模式
    const LEVELS = ['国保', '省保', '市保', '县保', '未定级'];

    // 缓存
    const projectCache = new Map();
    const iconCache = new Map();
    let lastVisible = new Set();

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
                console.error('data.json 加载失败');
                return [];
            }));
            if (!allData.length) throw new Error('data.json 为空或无效');

            // 提前缓存项目
            allData.forEach(city => {
                city.districts.forEach(district => {
                    district.projects.forEach(project => {
                        projectCache.set(project.id, project);
                    });
                });
            });

            flatTreeData = buildFlatTreeData(mode);
            buildTreeMenu();
            addMapMarkers();
            setupInteractions();

            updateMapMarkersVisibility(flatTreeData.filter(item => item.type === 'project').map(item => item.id));
            document.querySelectorAll('.loading').forEach(el => el.remove());
            console.info('初始化完成');
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
                const count = projects.length;
                const categoryId = `level-${levelName.toLowerCase().slice(0, 3)}`;
                flatData.push({ type: 'level-category', id: categoryId, name: levelName, projectCount: count, expanded: false, level: 1, parentId: 'shanxi', visible: true });
                projects.forEach(project => {
                    flatData.push({ type: 'project', id: project.id, name: project.name, url: project.url, level: 2, parentId: categoryId, visible: false });
                });
            });
        }

        return flatData;
    }

    // 新增：从 flatTreeData 递归构建 DOM（替换原 buildTreeMenu）
    function buildTreeMenu() {
        treeContainer.innerHTML = '';
        const ul = document.createElement('ul');
        ul.className = 'tree-root';

        const root = flatTreeData.find(i => i.type === 'province');
        if (root) ul.appendChild(buildNodeFromFlat(root));

        treeContainer.appendChild(ul);

        // 默认折叠级别模式子项目
        if (mode === 'level') {
            treeContainer.querySelectorAll('.level-category-item').forEach(li => {
                li.classList.remove('expanded');
                const subList = li.querySelector('ul');
                if (subList) subList.querySelectorAll('li').forEach(subLi => subLi.style.display = 'none');
            });
        }
    }

    function buildNodeFromFlat(item) {
        const li = document.createElement('li');
        li.className = `${item.type}-item${item.expanded ? ' expanded' : ''}`;
        li.dataset.itemId = item.id;

        if (item.type === 'project') {
            const urls = Array.isArray(item.url) ? item.url.filter(u => u && u.startsWith('http')) : [];
            li.innerHTML = `<a href="javascript:void(0)" class="project-link" data-project-id="${item.id}">${item.name}${urls.length > 1 ? ` <span class="multi-count">[${urls.length}]</span>` : ''}</a>`;
        } else {
            const titleClass = item.type === 'level-category' ? 'level-category-title' : `${item.type}-title`;
            li.innerHTML = `<div class="${titleClass} clickable-title"><span>${item.name}</span><span class="project-count">${item.projectCount || ''}</span></div>`;
        }

        const children = flatTreeData.filter(child => child.parentId === item.id);
        if (children.length) {
            const childUl = document.createElement('ul');
            childUl.className = `${item.type === 'province' ? 'cities' : item.type === 'city' ? 'districts' : 'projects'}-list`;
            children.forEach(child => childUl.appendChild(buildNodeFromFlat(child)));
            li.appendChild(childUl);
        }
        return li;
    }

    // 图标缓存
    function getCityIcon(city) {
        if (iconCache.has(city)) return iconCache.get(city);
        const color = (CITY_COLORS[city] || DEFAULT_COLOR).replace('#', '%23');
        const icon = new BMapGL.Icon(
            `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/><circle fill="rgba(25, 35, 50, 0.8)" cx="12" cy="9.5" r="1.5"/></svg>`,
            new BMapGL.Size(28, 28), { anchor: new BMapGL.Size(14, 28) }
        );
        iconCache.set(city, icon);
        return icon;
    }

    function addMapMarkers() {
        let markerCount = 0;
        allData.forEach(cityData => {
            const icon = getCityIcon(cityData.city);
            cityData.districts.forEach(districtData => {
                districtData.projects.forEach(project => {
                    try {
                        const point = new BMapGL.Point(project.longitude, project.latitude);
                        const marker = new BMapGL.Marker(point, { enableDragging: false, icon });
                        map.addOverlay(marker);

                        const linksHtml = generateLinksHtml(project);
                        const content = `<div><b>${project.name}</b>${linksHtml}</div>`;

                        marker.addEventListener("click", () => map.openInfoWindow(new BMapGL.InfoWindow(content), point));
                        allMapMarkers.set(project.id, marker);
                        markerCount++;
                    } catch (err) {
                        console.warn('添加标记点失败:', project.id, err);
                    }
                });
            });
        });
        console.info('地图标记点添加:', markerCount);
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

        if (modeToggle) {
            modeToggle.addEventListener('click', () => {
                mode = mode === 'geo' ? 'level' : 'geo';
                modeToggle.textContent = mode === 'geo' ? '切换到级别模式' : '切换到地理模式';
                flatTreeData = buildFlatTreeData(mode);
                buildTreeMenu();
                const allProjectIds = flatTreeData.filter(item => item.type === 'project').map(item => item.id);
                updateMapMarkersVisibility(allProjectIds);
                searchBox.value = '';
                filterTree('');
            });
        } else {
            console.warn('未找到模式切换按钮');
        }

        treeContainer.addEventListener('click', function (event) {
            const target = event.target;

            // 项目点击
            const projectLink = target.closest('.project-link');
            if (projectLink) {
                event.preventDefault();
                const projectId = projectLink.dataset.projectId;
                const marker = allMapMarkers.get(projectId);
                if (!map || !marker) return;

                if (map.getInfoWindow()) map.closeInfoWindow();

                const project = projectCache.get(projectId);
                if (!project) return;

                const linksHtml = generateLinksHtml(project);

                const content = `<div><b>${project.name}</b>${linksHtml}</div>`;
                const point = marker.getPosition();

                map.flyTo(point, 17, { duration: 800, pitch: 45 });
                map.addEventListener('moveend', function handler() {
                    map.openInfoWindow(new BMapGL.InfoWindow(content), point);
                    map.removeEventListener('moveend', handler);
                });

                return;
            }

            // 展开/折叠
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
                const itemId = parent.dataset.itemId;
                const item = flatTreeData.find(i => i.id === itemId);
                if (item) {
                    const projectIds = getChildProjectIds(item.id);
                    updateMapMarkersVisibility(projectIds);
                }
            }
        });

        function filterTree(searchTerm) {
            const visibleIds = [];
            const noResults = document.querySelector('.no-results');
            if (noResults) noResults.remove();

            if (searchTerm === '') {
                document.querySelectorAll('li').forEach(li => li.style.display = 'none');
                document.querySelectorAll('.province-item, .city-item, .level-category-item').forEach(li => {
                    li.style.display = 'block';
                    li.classList.remove('expanded');
                    const ul = li.querySelector('ul');
                    if (ul) ul.querySelectorAll('li').forEach(sub => sub.style.display = 'none');
                });
                document.querySelector('.province-item')?.classList.add('expanded');
                visibleIds.push(...flatTreeData.filter(i => i.type === 'project').map(i => i.id));
            } else {
                const foundProjectIds = new Set();
                allData.forEach(city => city.districts.forEach(d => d.projects.forEach(p => {
                    if (p.name.toLowerCase().includes(searchTerm)) foundProjectIds.add(p.id);
                })));
                visibleIds.push(...foundProjectIds);

                document.querySelectorAll('li').forEach(li => li.style.display = 'none');

                let hasResults = false;
                document.querySelectorAll('.project-item').forEach(projectLi => {
                    const link = projectLi.querySelector('.project-link');
                    if (link && link.textContent.toLowerCase().includes(searchTerm)) {
                        hasResults = true;
                        projectLi.style.display = 'block';

                        let parent = projectLi.parentElement;
                        while (parent && parent.tagName === 'UL') {
                            const parentLi = parent.parentElement;
                            if (parentLi) {
                                parentLi.style.display = 'block';
                                parentLi.classList.add('expanded');
                            }
                            parent = parentLi?.parentElement;
                        }
                    }
                });

                if (!hasResults && searchTerm) {
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
        const visibleSet = new Set(visibleIds);
        if (visibleSet.size === lastVisible.size && [...visibleSet].every(id => lastVisible.has(id))) return;

        allMapMarkers.forEach((marker, id) => {
            marker[visibleSet.has(id) ? 'show' : 'hide']();
        });
        lastVisible = new Set(visibleSet);
        console.info('更新标记点显隐:', visibleSet.size);
    }

    function generateLinksHtml(project) {
        const urls = Array.isArray(project.url) ? project.url.filter(u => u && u.startsWith('http')) : [];
        let linksHtml = '';
        if (urls.length === 0) {
            linksHtml = `<p style="color:#aaa;font-style:italic;">暂无全景链接</p>`;
        } else if (urls.length === 1) {
            linksHtml = `<p><a href="${urls[0]}" rel="noopener noreferrer">点击进入720全景</a></p>`;
        } else {
            // 新增：检查 url_names
            const urlNames = project.url_names || []; // 可选字段，默认空数组
            urls.forEach((u, i) => {
                const name = urlNames[i] || `全景 ${i + 1}`; // 优先用名字，fallback 旧标签
                linksHtml += `<p><a href="${u}" rel="noopener noreferrer">${name}</a></p>`;
            });
        }
        return linksHtml;
    }

    initialize();
});