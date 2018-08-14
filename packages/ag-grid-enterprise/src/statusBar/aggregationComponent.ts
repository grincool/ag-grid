import {
    _,
    Autowired,
    CellNavigationService,
    Component,
    Constants,
    Context,
    Events,
    EventService,
    GridOptions,
    GridOptionsWrapper,
    GridRow,
    IRowModel,
    PinnedRowModel,
    PostConstruct,
    RefSelector,
    RowNode,
    ValueService,
    VisibleChangedEvent
} from 'ag-grid';
import {RangeController} from "../rangeController";
import {AggregationValueComponent} from "./aggregationValueComponent";

export class AggregationComponent extends Component {

    private static TEMPLATE = `<div class="ag-status-bar-aggregations">
                <ag-avg-aggregation-comp key="average" default-value="Average" ref="avgAggregationComp"></ag-avg-aggregation-comp>
                <ag-count-aggregation-comp key="count" default-value="Count" ref="countAggregationComp"></ag-count-aggregation-comp>
                <ag-min-aggregation-comp key="min" default-value="Min" ref="minAggregationComp"></ag-min-aggregation-comp>
                <ag-max-aggregation-comp key="max" default-value="Max" ref="maxAggregationComp"></ag-max-aggregation-comp>
                <ag-sum-aggregation-comp key="sum" default-value="Sum" ref="sumAggregationComp"></ag-sum-aggregation-comp>
            </div>`;

    @Autowired('eventService') private eventService: EventService;
    @Autowired('rangeController') private rangeController: RangeController;
    @Autowired('valueService') private valueService: ValueService;
    @Autowired('cellNavigationService') private cellNavigationService: CellNavigationService;
    @Autowired('pinnedRowModel') private pinnedRowModel: PinnedRowModel;
    @Autowired('rowModel') private rowModel: IRowModel;
    @Autowired('context') private context: Context;
    @Autowired('gridOptionsWrapper') private gridOptionsWrapper: GridOptionsWrapper;
    @Autowired('gridOptions') private gridOptions: GridOptions;

    @RefSelector('sumAggregationComp') private sumAggregationComp: AggregationValueComponent;
    @RefSelector('countAggregationComp') private countAggregationComp: AggregationValueComponent;
    @RefSelector('minAggregationComp') private minAggregationComp: AggregationValueComponent;
    @RefSelector('maxAggregationComp') private maxAggregationComp: AggregationValueComponent;
    @RefSelector('avgAggregationComp') private avgAggregationComp: AggregationValueComponent;

    constructor() {
        super(AggregationComponent.TEMPLATE);
    }

    @PostConstruct
    private postConstruct(): void {
        this.instantiate(this.context);

        this.eventService.addEventListener(Events.EVENT_RANGE_SELECTION_CHANGED, this.onRangeSelectionChanged.bind(this));
        this.eventService.addEventListener(Events.EVENT_MODEL_UPDATED, this.onRangeSelectionChanged.bind(this));
    }

    public init() {
    }

    private setAggregationComponentValue(aggFuncName: string, value: number, visible: boolean) {
        // if the parent component (statusBar) has set our visibility to false, we don't override it
        if (!this.gridOptionsWrapper.isShowAggregationPanel()) {
            return;
        }

        let aggregationValueComponent = this.getAggregationValueComponent(aggFuncName);
        if (_.exists(aggregationValueComponent)) {
            aggregationValueComponent.setValue(value);
            aggregationValueComponent.setVisible(visible);
        }
    }

    private getAggregationValueComponent(aggFuncName: string): AggregationValueComponent {
        // converts user supplied agg name to our reference - eg: sum => sumAggregationComp
        let refComponentName = `${aggFuncName}AggregationComp`;

        // if the user has specified the agAggregationPanelComp but no aggFuncs we show the all
        // if the user has specified the agAggregationPanelComp and aggFuncs, then we only show the aggFuncs listed
        let aggregationValueComponent: AggregationValueComponent = null;
        const aggregationPanelConfig = _.exists(this.gridOptions.statusPanel) ? _.find(this.gridOptions.statusPanel.components, aggFuncName) : null;
        if (_.exists(aggregationPanelConfig)) {
            // a little defensive here - if no componentParams show it, if componentParams we also expect aggFuncs
            if (!_.exists(aggregationPanelConfig.componentParams) ||
                (_.exists(aggregationPanelConfig.componentParams) &&
                    _.exists(aggregationPanelConfig.componentParams.aggFuncs) &&
                    _.exists(_.find(aggregationPanelConfig.componentParams.aggFuncs, (item) => item === aggFuncName)))
            ) {
                aggregationValueComponent = (<any>this)[refComponentName];
            }
        } else {
            // components not specified - assume we can show this component
            aggregationValueComponent = (<any>this)[refComponentName];
        }

        // either we can't find it (which would indicate a typo or similar user side), or the user has deliberately
        // not listed the component in aggFuncs
        return aggregationValueComponent;
    }

    private onRangeSelectionChanged(): void {
        let cellRanges = this.rangeController.getCellRanges();

        let sum = 0;
        let count = 0;
        let numberCount = 0;
        let min: number = null;
        let max: number = null;

        let cellsSoFar: any = {};

        if (!_.missingOrEmpty(cellRanges)) {

            cellRanges.forEach((cellRange) => {

                // get starting and ending row, remember rowEnd could be before rowStart
                let startRow = cellRange.start.getGridRow();
                let endRow = cellRange.end.getGridRow();

                let startRowIsFirst = startRow.before(endRow);

                let currentRow = startRowIsFirst ? startRow : endRow;
                let lastRow = startRowIsFirst ? endRow : startRow;

                while (true) {

                    let finishedAllRows = _.missing(currentRow) || lastRow.before(currentRow);
                    if (finishedAllRows) {
                        break;
                    }

                    cellRange.columns.forEach((column) => {

                        // we only want to include each cell once, in case a cell is in multiple ranges
                        let cellId = currentRow.getGridCell(column).createId();
                        if (cellsSoFar[cellId]) {
                            return;
                        }
                        cellsSoFar[cellId] = true;

                        let rowNode = this.getRowNode(currentRow);
                        if (_.missing(rowNode)) {
                            return;
                        }

                        let value = this.valueService.getValue(column, rowNode);

                        // if empty cell, skip it, doesn't impact count or anything
                        if (_.missing(value) || value === '') {
                            return;
                        }

                        // see if value is wrapped, can happen when doing count() or avg() functions
                        if (value.value) {
                            value = value.value;
                        }

                        if (typeof value === 'string') {
                            value = Number(value);
                        }

                        if (typeof value === 'number' && !isNaN(value)) {

                            sum += value;

                            if (max === null || value > max) {
                                max = value;
                            }

                            if (min === null || value < min) {
                                min = value;
                            }

                            numberCount++;
                        }
                        count++;
                    });

                    currentRow = this.cellNavigationService.getRowBelow(currentRow);
                }
            });
        }

        let gotResult = this.gridOptionsWrapper.isAlwaysShowStatusBar() || count > 1;
        let gotNumberResult = numberCount > 1;

        // we show count even if no numbers
        this.setAggregationComponentValue('count', count, gotResult);

        // show if numbers found
        this.setAggregationComponentValue('sum', sum, gotNumberResult);
        this.setAggregationComponentValue('min', min, gotNumberResult);
        this.setAggregationComponentValue('max', max, gotNumberResult);
        this.setAggregationComponentValue('avg', (sum / numberCount), gotNumberResult);

        // let the parent component know if any components are visible
        let event: VisibleChangedEvent = {
            type: Component.EVENT_VISIBLE_CHANGED,
            visible: gotResult || gotNumberResult
        };
        this.dispatchEvent(event);

    }

    private getRowNode(gridRow: GridRow): RowNode {
        switch (gridRow.floating) {
            case Constants.PINNED_TOP:
                return this.pinnedRowModel.getPinnedTopRowData()[gridRow.rowIndex];
            case Constants.PINNED_BOTTOM:
                return this.pinnedRowModel.getPinnedBottomRowData()[gridRow.rowIndex];
            default:
                return this.rowModel.getRow(gridRow.rowIndex);
        }
    }
}
