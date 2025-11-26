document.addEventListener('DOMContentLoaded', function () {
    // --- 配置 ---
    const AMAP_KEY = '49bc17f19355b82c1e96e469af87e4f9';

    const CITY_COLORS = { '太原市': '#40C4FF', '吕梁市': '#FFD700', '晋中市': '#81C784', '长治市': '#BA68C8', '运城市': '#FF8A65', '大同市': '#4DB6AC', '阳泉市': '#FFB74D', '朔州市': '#A1887F', '忻州市': '#90A4AE', '临汾市': '#F06292', '晋城市': '#64b605ff' };
    const DEFAULT_COLOR = '#E0E0E0';

    // --- 全局变量 ---
    const mapContainer = document.getElementById('map-container');
    const treeContainer = document.getElementById('tree-container');
    const sidebar = document.getElementById('tree-menu');
    const toggleButton = document.querySelector('.toggle-sidebar');

    let map;
    let AMapObj; // 保存加载后的 AMap 对象引用
    let allMapMarkers = new Map();
    let allData = [], flatTreeData = [];
    let mode = 'geo'; // 默认地理模式
    const LEVELS = ['国保', '省保', '市保', '县保', '未定级'];

    // 缓存
    const projectCache = new Map();
    const iconCache = new Map();
    let lastVisible = new Set();
    let currentInfoWindow = null;

    // --- 侧边栏切换 ---
    toggleButton.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        toggleButton.textContent = sidebar.classList.contains('active') ? '✕' : '☰';
    });

    // --- 坐标转换工具 (百度 BD-09 -> 高德 GCJ-02) ---
    function bd09ToGcj02(bd_lon, bd_lat) {
        const x_pi = 3.14159265358979324 * 3000.0 / 180.0;
        const x = bd_lon - 0.0065;
        const y = bd_lat - 0.006;
        const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * x_pi);
        const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * x_pi);
        const gg_lon = z * Math.cos(theta);
        const gg_lat = z * Math.sin(theta);
        return [gg_lon, gg_lat];
    }

    // --- 初始化 ---
    async function initialize() {
        if (!mapContainer || !treeContainer) return;

        try {
            // 1. 加载高德地图 API
            AMapObj = await AMapLoader.load({
                key: AMAP_KEY,
                version: "2.0",
                plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.TileLayer', 'AMap.MapType']
            });

            // 2. 准备图层
            const satelliteLayer = new AMapObj.TileLayer.Satellite();   //卫星底图
            const roadNetLayer = new AMapObj.TileLayer.RoadNet({
                zooms: [1, 2],
                opacity: 0.7
            });     //路网叠加图层  调整zooms到顶层，使正常观看时不显示路网

            // 3. 初始化地图实例
            const centerPoint = bd09ToGcj02(112.55, 37.87);

            map = new AMapObj.Map('map-container', {
                zoom: 8,
                center: centerPoint,
                viewMode: '3D',
                pitch: 0,
                // 叠加图层
                layers: [
                    satelliteLayer,
                    roadNetLayer
                ]
            });

            map.addControl(new AMapObj.Scale());
            map.addControl(new AMapObj.ToolBar());

            // 4. 加载数据
            allData = validateAndCleanData(await (await fetch('data.json')).json().catch(() => {
                console.error('data.json 加载失败');
                return [];
            }));
            if (!allData.length) throw new Error('data.json 为空或无效');

            // 缓存项目
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
        data.forEach(city => {
            city.districts.forEach(district => {
                for (let i = district.projects.length - 1; i >= 0; i--) {
                    const project = district.projects[i];
                    if (!project.id || !project.name || isNaN(project.longitude)) {
                        district.projects.splice(i, 1);
                    } else if (!project.protectionLevel) {
                        project.protectionLevel = '未定级';
                    }
                }
            });
        });
        return data;
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
        } else {
            const levelGroups = new Map(LEVELS.map(l => [l, []]));
            allData.forEach(city => {
                city.districts.forEach(district => {
                    district.projects.forEach(project => {
                        const level = project.protectionLevel || '未定级';
                        if (levelGroups.has(level)) levelGroups.get(level).push(project);
                        totalProjectCount++;
                    });
                });
            });
            flatData.push({ type: 'province', id: 'shanxi', name: '山西省', projectCount: totalProjectCount, expanded: true, level: 0, visible: true });
            LEVELS.forEach(levelName => {
                const projects = levelGroups.get(levelName) || [];
                const categoryId = `level-${levelName.toLowerCase().slice(0, 3)}`;
                flatData.push({ type: 'level-category', id: categoryId, name: levelName, projectCount: projects.length, expanded: false, level: 1, parentId: 'shanxi', visible: true });
                projects.forEach(project => {
                    flatData.push({ type: 'project', id: project.id, name: project.name, url: project.url, level: 2, parentId: categoryId, visible: false });
                });
            });
        }
        return flatData;
    }

    function buildTreeMenu() {
        treeContainer.innerHTML = '';
        const ul = document.createElement('ul');
        ul.className = 'tree-root';
        const root = flatTreeData.find(i => i.type === 'province');
        if (root) ul.appendChild(buildNodeFromFlat(root));
        treeContainer.appendChild(ul);

        if (mode === 'level') {
            document.querySelectorAll('.level-category-item').forEach(li => {
                li.classList.remove('expanded');
                li.querySelector('ul')?.querySelectorAll('li').forEach(s => s.style.display = 'none');
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

    // --- 修复1：获取高德图标（颜色修正） ---
    function getCityIcon(city) {
        if (iconCache.has(city)) return iconCache.get(city);

        //使用原始颜色
        const color = CITY_COLORS[city] || DEFAULT_COLOR;

        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"><path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/><circle fill="rgba(25, 35, 50, 0.8)" cx="12" cy="9.5" r="1.5"/></svg>`;

        const icon = new AMapObj.Icon({
            size: new AMapObj.Size(28, 28),
            image: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgContent),
            imageSize: new AMapObj.Size(28, 28),
            anchor: 'bottom-center'
        });

        iconCache.set(city, icon);
        return icon;
    }

    // --- 添加高德标记 ---
    function addMapMarkers() {
        let markerCount = 0;

        allData.forEach(cityData => {
            const icon = getCityIcon(cityData.city);
            cityData.districts.forEach(districtData => {
                districtData.projects.forEach(project => {
                    try {
                        const lnglat = bd09ToGcj02(project.longitude, project.latitude);

                        const marker = new AMapObj.Marker({
                            position: new AMapObj.LngLat(lnglat[0], lnglat[1]),
                            icon: icon,
                            title: project.name,
                            anchor: 'bottom-center',
                            offset: new AMapObj.Pixel(0, 0)
                        });

                        const linksHtml = generateLinksHtml(project);
                        const contentHtml = `
                            <div class="custom-info-window">
                                <div class="info-header">
                                    <b>${project.name}</b>
                                    <span class="close-btn" onclick="closeInfoWindow()">×</span>
                                </div>
                                <div class="info-body">${linksHtml}</div>
                            </div>
                        `;

                        marker.on('click', () => {
                            openCustomInfoWindow(marker.getPosition(), contentHtml);
                        });

                        marker.hide();
                        marker.setMap(map);

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

    // --- 自定义信息窗体逻辑 ---
    function openCustomInfoWindow(position, content) {
        if (currentInfoWindow) {
            currentInfoWindow.close();
        }

        currentInfoWindow = new AMapObj.InfoWindow({
            isCustom: true,
            content: content,
            offset: new AMapObj.Pixel(0, -35),
            autoMove: false //禁止窗体自动移动地图，手动控制中心点
        });

        currentInfoWindow.open(map, position);
    }

    window.closeInfoWindow = function () {
        if (currentInfoWindow) currentInfoWindow.close();
    };

    function getChildProjectIds(parentId) {
        const projectIds = [];
        function collectProjects(id) {
            flatTreeData.forEach(item => {
                if (item.parentId === id) {
                    if (item.type === 'project') projectIds.push(item.id);
                    else collectProjects(item.id);
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
        }

        treeContainer.addEventListener('click', function (event) {
            const target = event.target;
            const projectLink = target.closest('.project-link');

            if (projectLink) {
                event.preventDefault();
                const projectId = projectLink.dataset.projectId;
                const marker = allMapMarkers.get(projectId);
                if (!map || !marker) return;

                if (currentInfoWindow) currentInfoWindow.close();

                const project = projectCache.get(projectId);
                if (!project) return;

                const linksHtml = generateLinksHtml(project);
                const contentHtml = `
                    <div class="custom-info-window">
                        <div class="info-header">
                            <b>${project.name}</b>
                            <span class="close-btn" onclick="closeInfoWindow()">×</span>
                        </div>
                        <div class="info-body">${linksHtml}</div>
                    </div>
                `;

                const position = marker.getPosition();

                // 缩放级别，动画时间
                map.setZoomAndCenter(15, position, false, 800);

                // 地图动画结束后再打开窗体
                setTimeout(() => {
                    openCustomInfoWindow(position, contentHtml);
                }, 850);

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
            document.querySelector('.no-results')?.remove();

            if (searchTerm === '') {
                document.querySelectorAll('li').forEach(li => li.style.display = 'none');
                document.querySelectorAll('.province-item, .city-item, .level-category-item').forEach(li => {
                    li.style.display = 'block';
                    li.classList.remove('expanded');
                    li.querySelector('ul')?.querySelectorAll('li').forEach(s => s.style.display = 'none');
                });
                document.querySelector('.province-item')?.classList.add('expanded');
                visibleIds.push(...flatTreeData.filter(i => i.type === 'project').map(i => i.id));
            } else {
                const foundIds = new Set();
                allData.forEach(city => city.districts.forEach(d => d.projects.forEach(p => {
                    if (p.name.toLowerCase().includes(searchTerm)) foundIds.add(p.id);
                })));
                visibleIds.push(...foundIds);

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
            if (visibleSet.has(id)) {
                marker.show();
            } else {
                marker.hide();
            }
        });
        lastVisible = new Set(visibleSet);
    }

    function generateLinksHtml(project) {
        const urls = Array.isArray(project.url) ? project.url.filter(u => u && u.startsWith('http')) : [];
        let linksHtml = '';
        if (urls.length === 0) {
            linksHtml = `<p style="color:#aaa;font-style:italic;">暂无全景链接</p>`;
        } else {
            const urlNames = project.url_names || [];
            urls.forEach((u, i) => {
                const name = urlNames[i] || (urls.length === 1 ? '点击进入720全景' : `全景 ${i + 1}`);
                linksHtml += `<p><a href="${u}" rel="noopener noreferrer">${name}</a></p>`;
            });
        }
        return linksHtml;
    }

    // 启动
    initialize();
});