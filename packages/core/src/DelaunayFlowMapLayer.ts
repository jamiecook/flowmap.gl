/*
 * Copyright 2018 Teralytics
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import { CompositeLayer } from '@deck.gl/core';
import { GeoJsonLayer } from '@deck.gl/layers';
import AnimatedFlowLinesLayer from './AnimatedFlowLinesLayer/AnimatedFlowLinesLayer';
import { Colors, DiffColors } from './colors';
import FlowCirclesLayer from './FlowCirclesLayer/FlowCirclesLayer';
import FlowLinesLayer from './FlowLinesLayer/FlowLinesLayer';
import FlowMapLayer from './FlowMapLayer';
import { getLayerId, getPickType, LayerKind, Props } from './FlowMapLayer';
import Selectors from './Selectors';
import {
  DeckGLLayer,
  Flow,
  FlowAccessor,
  FlowLayerPickingInfo,
  isFeatureCollection,
  Location,
  LocationAccessor,
  LocationCircle,
  LocationCircleAccessor,
  LocationCircleType,
  Locations,
  PickingHandler,
  PickingType,
} from './types';

export class DelaunayFlowMapLayer extends FlowMapLayer {
  static layerName: string = 'DelaunayFlowMapLayer';
  static defaultProps = {
    getLocationId: { type: 'accessor', value: (l: Location) => l.id || l.properties.id },
    getLocationCentroid: { type: 'accessor', value: (l: Location) => l.properties.centroid },
    getFlowOriginId: { type: 'accessor', value: (f: Flow) => f.origin },
    getFlowDestId: { type: 'accessor', value: (f: Flow) => f.dest },
    getFlowMagnitude: { type: 'accessor', value: (f: Flow) => f.magnitude },
    showTotals: true,
    locationCircleSize: 6,
    outlineThickness: 1,
    showLocationAreas: true,
    varyFlowColorByMagnitude: true,
  };
  props!: Props;

  constructor(props: Props) {
    super(props);
  }

  initializeState() {
    const {
      getLocationTotalIn,
      getLocationTotalOut,
      getLocationId,
      getFlowOriginId,
      getFlowDestId,
      getFlowMagnitude,
      getFlowColor,
    } = this.props;
    const selectors = new Selectors({
      getLocationId: getLocationId!,
      getLocationTotalIn,
      getLocationTotalOut,
      getFlowOriginId: getFlowOriginId!,
      getFlowDestId: getFlowDestId!,
      getFlowMagnitude: getFlowMagnitude!,
      getFlowColor,
    });

    this.setState({ selectors });
  }

  updateState(params: any) {
    super.updateState(params);

    const { props, changeFlags } = params;
    if (changeFlags.propsChanged) {
      const {
        getLocationTotalIn,
        getLocationTotalOut,
        getLocationId,
        getFlowOriginId,
        getFlowDestId,
        getFlowMagnitude,
        getFlowColor,
      } = props;
      this.state.selectors.setInputGetters({
        getLocationId,
        getLocationTotalIn,
        getLocationTotalOut,
        getFlowOriginId,
        getFlowDestId,
        getFlowMagnitude,
        getFlowColor,
      });
    }
  }

  getPickingInfo(params: any): FlowLayerPickingInfo {
    const type = getPickType(params.sourceLayer);
    if (!type) {
      return params.info;
    }

    const info = {
      ...params.info,
      type,
    };

    const { selectors } = this.state;
    if (type === PickingType.FLOW) {
      const getLocationById = selectors.getLocationByIdGetter(this.props);
      const { getFlowOriginId, getFlowDestId } = selectors.getInputGetters();
      const flow = info.object as Flow;
      return {
        ...info,
        ...(flow && {
          origin: getLocationById(getFlowOriginId(flow)),
          dest: getLocationById(getFlowDestId(flow)),
        }),
      };
    }

    if (type === PickingType.LOCATION || type === PickingType.LOCATION_AREA) {
      const location: Location = type === PickingType.LOCATION ? info.object && info.object.location : info.object;
      const getLocationTotalIn = selectors.getLocationTotalInGetter(this.props);
      const getLocationTotalOut = selectors.getLocationTotalOutGetter(this.props);
      const getLocationTotalWithin = selectors.getLocationTotalWithinGetter(this.props);
      const getLocationCircleRadius = selectors.getLocationCircleRadiusGetter(this.props);

      return {
        ...info,
        ...(location && {
          object: location,
          totalIn: getLocationTotalIn(location),
          totalOut: getLocationTotalOut(location),
          totalWithin: getLocationTotalWithin(location),
          circleRadius: getLocationCircleRadius({ location, type: LocationCircleType.OUTER }),
        }),
      };
    }

    return info;
  }

  getDelaunayFlowLinesLayer(
    id: string,
    flows: Flow[],
    highlighted: boolean,
    dimmed: boolean,
  ): FlowLinesLayer | AnimatedFlowLinesLayer {
    const {
      getFlowOriginId,
      getFlowDestId,
      getFlowMagnitude,
      getLocationCentroid,
      showTotals,
      locationCircleSize,
      outlineThickness,
    } = this.props;
    const { selectors } = this.state;

    const endpointOffsets: [number, number] = [(locationCircleSize || 0) + 1, (locationCircleSize || 0) + 1];
    const getLocationRadius = selectors.getLocationCircleRadiusGetter(this.props);
    const getLocationById = selectors.getLocationByIdGetter(this.props);
    const flowThicknessScale = selectors.getFlowThicknessScale(this.props);
    const getSourcePosition: FlowAccessor<[number, number]> = flow =>
      getLocationCentroid!(getLocationById(getFlowOriginId!(flow)));
    const getTargetPosition: FlowAccessor<[number, number]> = flow =>
      getLocationCentroid!(getLocationById(getFlowDestId!(flow)));
    const getThickness: FlowAccessor<number> = flow => flowThicknessScale(getFlowMagnitude!(flow));
    const getEndpointOffsets: FlowAccessor<[number, number]> = flow => {
      if (!showTotals) {
        return endpointOffsets;
      }

      return [
        getLocationRadius({
          location: getLocationById(getFlowOriginId!(flow)),
          type: LocationCircleType.OUTLINE,
        }),
        getLocationRadius({
          location: getLocationById(getFlowDestId!(flow)),
          type: LocationCircleType.OUTLINE,
        }),
      ];
    };
    const flowColorScale = selectors.getFlowColorScale(this.props);
    const colors = selectors.getColors(this.props);
    const getColor = selectors.getFlowLinesColorGetter(colors, flowColorScale, highlighted, dimmed);

    const baseProps = {
      id,
      getSourcePosition,
      getTargetPosition,
      getThickness,
      getEndpointOffsets,
      getColor,
      data: [],
      opacity: 1,
      pickable: !highlighted,
      drawOutline: !dimmed,
      updateTriggers: {
        getColor: { dimmed },
        getEndpointOffsets: {
          showTotals,
        },
      },
      outlineColor: colors.outlineColor,
      ...(outlineThickness && { outlineThickness }),
    };
    const { animate } = this.props;
    console.log('JAMIE');
    if (animate) {
      return new AnimatedFlowLinesLayer({
        ...baseProps,
        currentTime: this.props.animationCurrentTime,
      });
    } else {
      return new FlowLinesLayer(baseProps);
    }
  }

  renderLayers() {
    const { showLocationAreas, locations, highlightedLocationId } = this.props;
    const { selectors } = this.state;

    const topFlows = selectors.getTopFlows(this.props);
    const highlightedFlows = selectors.getHighlightedFlows(this.props);
    const isLocationHighlighted = highlightedLocationId != null;
    const locationCircles = selectors.getLocationCircles(this.props);

    const layers: DeckGLLayer[] = [];

    if (showLocationAreas && isFeatureCollection(locations)) {
      layers.push(this.getLocationAreasLayer(getLayerId(this.props.id, LayerKind.LOCATION_AREAS)));
    }
    layers.push(
      this.getDelaunayFlowLinesLayer(
        getLayerId(this.props.id, LayerKind.FLOWS),
        topFlows,
        false,
        isLocationHighlighted,
      ),
    );
    if (highlightedFlows) {
      layers.push(
        this.getDelaunayFlowLinesLayer(
          getLayerId(this.props.id, LayerKind.FLOWS_HIGHLIGHTED),
          highlightedFlows,
          true,
          false,
        ),
      );
    }
    layers.push(this.getLocationCirclesLayer(getLayerId(this.props.id, LayerKind.LOCATIONS), locationCircles, false));
    if (isLocationHighlighted) {
      const highlightedLocationCircles = selectors.getHighlightedLocationCircles(this.props);
      layers.push(
        this.getLocationCirclesLayer(
          getLayerId(this.props.id, LayerKind.LOCATIONS_HIGHLIGHTED),
          highlightedLocationCircles,
          true,
        ),
      );
    }
    return layers;
  }
}