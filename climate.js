(async function () {

  const GEO_URL = 'https://cdn.jsdelivr.net/gh/holtzy/D3-graph-gallery@master/DATA/world.geojson';

  let geoData, climateData;
  try {
    [geoData, climateData] = await Promise.all([
      d3.json(GEO_URL),
      d3.json('data/climate_data.json'),
    ]);
  } catch (e) {
    document.getElementById('map-view').innerHTML =
      '<p style="color:#c92a2a;padding:3rem;font-size:1rem">' +
      '⚠ Could not load data/climate_data.json. ' +
      'Run export_data.py in Colab first, then place the file in the data/ folder.</p>';
    return;
  }

  const countries = geoData;

  const missing = geoData.features
    .map(f => f.properties.name)
    .filter(n => !climateData[n]);
  if (missing.length) console.log('No climate data for:', missing);

  const BIN_THRESHOLDS = [0.5, 1.0, 1.5, 2.0, 2.5];
  const BIN_COLORS     = d3.schemeYlOrRd[6];
  const colorScale     = d3.scaleThreshold().domain(BIN_THRESHOLDS).range(BIN_COLORS);
  const NO_DATA_COLOR  = '#e9ecef';

  const BIN_LABELS = ['<0.5', '0.5–1.0', '1.0–1.5', '1.5–2.0', '2.0–2.5', '≥2.5'];

  function anomalyForRange(cd, y0, y1) {
    if (!cd || !cd.timeseries) return null;
    const inRange = cd.timeseries.filter(t => t.year >= y0 && t.year <= y1);
    if (!inRange.length) return null;
    return d3.mean(inRange, t => t.anomaly);
  }

  let mapYearStart = 2000;
  let mapYearEnd   = 2014;

  let activeCountry = null;
  let currentMetric = 'annual';
  let yearStart     = 1850;
  let yearEnd       = 2014;

  const mapSvg  = d3.select('#world-map');
  const mapNode = mapSvg.node();

  let mapG;
  let mapW, mapH;
  let projection;
  let pathGen;

  function buildMap() {
    mapW = mapNode.clientWidth || 960;
    mapH = Math.min(Math.round(mapW * 0.54), Math.round(window.innerHeight * 0.72));
    mapNode.style.height = mapH + 'px';
    mapSvg.attr('viewBox', `0 0 ${mapW} ${mapH}`);

    projection = d3.geoNaturalEarth1().fitSize([mapW, mapH], { type: 'Sphere' });
    pathGen    = d3.geoPath().projection(projection);

    mapSvg.selectAll('*').remove();

    mapSvg.append('rect')
      .attr('class', 'ocean')
      .attr('width', mapW).attr('height', mapH)
      .attr('fill', '#d8e9f5');

    mapG = mapSvg.append('g').attr('class', 'map-g');

    mapG.append('path')
      .datum(d3.geoGraticule()())
      .attr('d', pathGen)
      .attr('fill', 'none')
      .attr('stroke', '#b1c9da')
      .attr('stroke-width', 0.4);

    mapG.append('path')
      .datum({ type: 'Sphere' })
      .attr('d', pathGen)
      .attr('fill', 'none')
      .attr('stroke', '#7ea9c2')
      .attr('stroke-width', 0.8);

    mapG.selectAll('.country')
      .data(countries.features)
      .join('path')
      .attr('class', d => 'country' + (climateData[d.properties.name] ? ' has-data' : ''))
      .attr('d', pathGen)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 0.4)
      .on('mouseover', onMouseOver)
      .on('mousemove', onMouseMove)
      .on('mouseout',  onMouseOut)
      .on('click',     onCountryClick);

    recolorMap();
  }

  function recolorMap() {
    if (!mapG) return;
    mapG.selectAll('.country')
      .attr('fill', d => {
        const cd  = climateData[d.properties.name];
        const val = anomalyForRange(cd, mapYearStart, mapYearEnd);
        return val == null ? NO_DATA_COLOR : colorScale(val);
      });
  }

  buildMap();
  window.addEventListener('resize', buildMap);

  (function drawLegend() {
    const svg = d3.select('#legend-svg');
    const n   = BIN_COLORS.length;
    const cellW = 36, cellH = 14, gap = 0;
    const totalW = cellW * n;
    svg.attr('width', totalW).attr('height', cellH + 14);

    BIN_COLORS.forEach((color, i) => {
      svg.append('rect')
        .attr('x', i * (cellW + gap))
        .attr('y', 0)
        .attr('width', cellW)
        .attr('height', cellH)
        .attr('fill', color)
        .attr('stroke', '#d0d7de')
        .attr('stroke-width', 0.5);

      svg.append('text')
        .attr('x', i * (cellW + gap) + cellW / 2)
        .attr('y', cellH + 11)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9)
        .attr('fill', '#656d76')
        .text(BIN_LABELS[i]);
    });
  })();

  const mapSliderStart = document.getElementById('map-slider-start');
  const mapSliderEnd   = document.getElementById('map-slider-end');
  const mapYearStartEl = document.getElementById('map-year-start');
  const mapYearEndEl   = document.getElementById('map-year-end');

  function onMapSlider() {
    let s = +mapSliderStart.value;
    let e = +mapSliderEnd.value;
    if (s > e) { s = e; mapSliderStart.value = s; }
    mapYearStart = s;
    mapYearEnd   = e;
    mapYearStartEl.textContent = s;
    mapYearEndEl.textContent   = e;
    recolorMap();
  }

  mapSliderStart.addEventListener('input', onMapSlider);
  mapSliderEnd  .addEventListener('input', onMapSlider);

  const tooltip = document.getElementById('tooltip');

  function onMouseOver(event, d) {
    const cd = climateData[d.properties.name];
    if (!cd) return;
    const val = anomalyForRange(cd, mapYearStart, mapYearEnd);
    if (val == null) return;
    const sign = val >= 0 ? '+' : '';
    tooltip.innerHTML =
      `<div class="tt-name">${cd.name}</div>` +
      `<div class="tt-val">${sign}${val.toFixed(2)}°C warming</div>` +
      `<div class="tt-hint">${mapYearStart}–${mapYearEnd} avg vs 1850–1900 · Click to explore</div>`;
    tooltip.classList.add('visible');
  }

  function onMouseMove(event) {
    tooltip.style.left = (event.clientX + 14) + 'px';
    tooltip.style.top  = (event.clientY - 10) + 'px';
  }

  function onMouseOut() {
    tooltip.classList.remove('visible');
  }

  function onCountryClick(event, d) {
    const cd = climateData[d.properties.name];
    if (!cd) return;

    tooltip.classList.remove('visible');

    const bounds = pathGen.bounds(d);
    const bw = bounds[1][0] - bounds[0][0];
    const bh = bounds[1][1] - bounds[0][1];
    const cx = (bounds[0][0] + bounds[1][0]) / 2;
    const cy = (bounds[0][1] + bounds[1][1]) / 2;
    const scale = Math.max(1.4, Math.min(8, 0.55 * Math.min(mapW / bw, mapH / bh)));
    const tx = mapW / 2 - cx * scale;
    const ty = mapH / 2 - cy * scale;

    mapG.transition()
      .duration(750)
      .ease(d3.easeCubicInOut)
      .attr('transform', `translate(${tx},${ty}) scale(${scale})`);

    mapG.selectAll('.country')
      .filter(o => o !== d)
      .transition().duration(500).attr('opacity', 0.25);

    mapG.selectAll('.country')
      .filter(o => o === d)
      .transition().duration(500)
      .attr('stroke', '#1f2328')
      .attr('stroke-width', 0.3);

    setTimeout(() => {
      activeCountry = cd;
      yearStart = 1850;
      yearEnd   = 2014;

      document.getElementById('slider-start').value = 1850;
      document.getElementById('slider-end').value   = 2014;
      document.getElementById('lbl-start').textContent = 1850;
      document.getElementById('lbl-end').textContent   = 2014;

      const overall = anomalyForRange(cd, mapYearStart, mapYearEnd);
      const sign    = overall >= 0 ? '+' : '';
      document.getElementById('country-name').textContent = cd.name;
      document.getElementById('country-stat').textContent =
        `${sign}${overall.toFixed(2)}°C warmer than 1850–1900 (${mapYearStart}–${mapYearEnd} average)`;

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-metric="annual"]').classList.add('active');
      currentMetric = 'annual';

      const mv = document.getElementById('map-view');
      const dv = document.getElementById('detail-view');
      mv.classList.add('fading-out');

      setTimeout(() => {
        mv.classList.add('hidden');
        mv.classList.remove('fading-out');
        dv.classList.add('visible');
        drawDetailChart();
      }, 350);
    }, 700);
  }

  document.getElementById('back-btn').addEventListener('click', () => {
    const mv = document.getElementById('map-view');
    const dv = document.getElementById('detail-view');

    dv.classList.remove('visible');
    setTimeout(() => {
      mv.classList.remove('hidden');
      mv.offsetHeight;
      mv.classList.remove('fading-out');

      mapG.transition()
        .duration(700)
        .ease(d3.easeCubicInOut)
        .attr('transform', null);

      mapG.selectAll('.country')
        .transition().duration(500)
        .attr('opacity', 1)
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 0.4);

      activeCountry = null;
    }, 350);
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMetric = btn.dataset.metric;
      if (activeCountry) drawDetailChart();
    });
  });

  document.getElementById('slider-start').addEventListener('input', function () {
    yearStart = +this.value;
    if (yearStart > yearEnd) { yearStart = yearEnd; this.value = yearStart; }
    document.getElementById('lbl-start').textContent = yearStart;
    if (activeCountry) drawDetailChart();
  });

  document.getElementById('slider-end').addEventListener('input', function () {
    yearEnd = +this.value;
    if (yearEnd < yearStart) { yearEnd = yearStart; this.value = yearEnd; }
    document.getElementById('lbl-end').textContent = yearEnd;
    if (activeCountry) drawDetailChart();
  });

  function drawDetailChart() {
    const svgEl  = document.getElementById('detail-chart');
    const totalW = svgEl.clientWidth || 860;
    const totalH = 420;
    const m = { top: 24, right: 36, bottom: 56, left: 66 };
    const W = totalW - m.left - m.right;
    const H = totalH - m.top  - m.bottom;

    const svg = d3.select('#detail-chart')
      .attr('width', totalW)
      .attr('height', totalH);

    svg.selectAll('*').remove();
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    if (currentMetric === 'annual') drawAnnual(g, W, H);
    else                             drawDecadal(g, W, H);
  }

  function drawAnnual(g, W, H) {
    const data = activeCountry.timeseries.filter(d => d.year >= yearStart && d.year <= yearEnd);
    if (data.length === 0) return;

    const rolled = rollingMean(data, 10);

    const x = d3.scaleLinear().domain([yearStart, yearEnd]).range([0, W]);
    const allY = [...data.map(d => d.anomaly), ...rolled.filter(r => r.m != null).map(r => r.m)];
    const y = d3.scaleLinear().domain(d3.extent(allY)).nice().range([H, 0]);

    g.append('g').selectAll('.grid-line')
      .data(y.ticks(5))
      .join('line').attr('class', 'grid-line')
      .attr('x1', 0).attr('x2', W)
      .attr('y1', d => y(d)).attr('y2', d => y(d));

    if (y.domain()[0] < 0 && y.domain()[1] > 0) {
      g.append('line').attr('class', 'zero-line')
        .attr('x1', 0).attr('x2', W)
        .attr('y1', y(0)).attr('y2', y(0));
    }

    g.append('path')
      .datum(data)
      .attr('fill', '#c92a2a').attr('opacity', 0.1)
      .attr('d', d3.area()
        .x(d => x(d.year))
        .y0(y(Math.max(y.domain()[0], 0)))
        .y1(d => y(d.anomaly))
        .curve(d3.curveMonotoneX));

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#c92a2a').attr('stroke-width', 1).attr('opacity', 0.35)
      .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.anomaly)).curve(d3.curveMonotoneX));

    const cleanRolled = rolled.filter(r => r.m != null);
    if (cleanRolled.length > 0) {
      g.append('path')
        .datum(cleanRolled)
        .attr('fill', 'none')
        .attr('stroke', '#c92a2a').attr('stroke-width', 2.8)
        .attr('d', d3.line().x(d => x(d.year)).y(d => y(d.m)).curve(d3.curveMonotoneX));
    }

    g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8));

    g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).tickFormat(d => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°C`));

    g.append('text').attr('class', 'axis-label')
      .attr('x', W / 2).attr('y', H + 44).attr('text-anchor', 'middle')
      .text('Year');

    g.append('text').attr('class', 'axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('x', -H / 2).attr('y', -52).attr('text-anchor', 'middle')
      .text('Anomaly vs 1850–1900 (°C)');

    const leg = g.append('g').attr('transform', `translate(${W - 160}, 0)`);
    leg.append('line').attr('x2', 18).attr('y1', 8).attr('y2', 8)
      .attr('stroke', '#c92a2a').attr('stroke-width', 1).attr('opacity', 0.4);
    leg.append('text').attr('class', 'legend-text').attr('x', 22).attr('y', 12).text('Annual');
    leg.append('line').attr('x2', 18).attr('y1', 26).attr('y2', 26)
      .attr('stroke', '#c92a2a').attr('stroke-width', 2.8);
    leg.append('text').attr('class', 'legend-text').attr('x', 22).attr('y', 30).text('10-yr rolling mean');
  }

  function drawDecadal(g, W, H) {
    const data = activeCountry.decadal.filter(d => d.year >= yearStart && d.year <= yearEnd);
    if (data.length === 0) return;

    const x = d3.scaleBand().domain(data.map(d => d.decade)).range([0, W]).padding(0.22);
    const yMin = Math.min(0, d3.min(data, d => d.anomaly) - 0.05);
    const yMax = d3.max(data, d => d.anomaly) + 0.08;
    const y = d3.scaleLinear().domain([yMin, yMax]).nice().range([H, 0]);

    const barColor = colorScale;

    g.append('g').selectAll('.grid-line')
      .data(y.ticks(5)).join('line').attr('class', 'grid-line')
      .attr('x1', 0).attr('x2', W)
      .attr('y1', d => y(d)).attr('y2', d => y(d));

    g.append('line').attr('class', 'zero-line')
      .attr('x1', 0).attr('x2', W).attr('y1', y(0)).attr('y2', y(0));

    g.selectAll('.bar').data(data).join('rect').attr('class', 'bar')
      .attr('x',      d => x(d.decade))
      .attr('width',  x.bandwidth())
      .attr('y',      d => d.anomaly >= 0 ? y(d.anomaly) : y(0))
      .attr('height', d => Math.abs(y(d.anomaly) - y(0)))
      .attr('fill',   d => barColor(Math.max(0, d.anomaly)))
      .attr('stroke', '#c0c5cb')
      .attr('stroke-width', 0.5)
      .attr('rx', 3);

    g.selectAll('.bar-label').data(data).join('text').attr('class', 'bar-label')
      .attr('x', d => x(d.decade) + x.bandwidth() / 2)
      .attr('y', d => d.anomaly >= 0 ? y(d.anomaly) - 5 : y(d.anomaly) + 13)
      .attr('text-anchor', 'middle')
      .text(d => `${d.anomaly >= 0 ? '+' : ''}${d.anomaly.toFixed(2)}`);

    g.append('g').attr('class', 'axis')
      .attr('transform', `translate(0,${H})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-40)')
      .style('text-anchor', 'end');

    g.append('g').attr('class', 'axis')
      .call(d3.axisLeft(y).tickFormat(d => `${d >= 0 ? '+' : ''}${d.toFixed(1)}°C`));

    g.append('text').attr('class', 'axis-label')
      .attr('x', W / 2).attr('y', H + 50).attr('text-anchor', 'middle')
      .text('Decade');

    g.append('text').attr('class', 'axis-label')
      .attr('transform', 'rotate(-90)')
      .attr('x', -H / 2).attr('y', -52).attr('text-anchor', 'middle')
      .text('Anomaly vs 1850–1900 (°C)');
  }

  function rollingMean(data, w) {
    const half = Math.floor(w / 2);
    return data.map((d, i) => {
      const slice = data.slice(Math.max(0, i - half), Math.min(data.length, i + half + 1));
      const m = slice.length >= half ? d3.mean(slice, s => s.anomaly) : null;
      return { year: d.year, m };
    });
  }

})();
