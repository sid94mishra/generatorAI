// B-01 ModelPicker (03 §2.1): the connected block, its pure view and the read-model helpers.
export { ModelPicker, type ModelPickerProps } from './ModelPicker.js';
export { useModelLabel } from './useModelLabel.js';
export { ModelLabel, type ModelLabelProps } from './ModelLabel.js';
export { ModelPickerView, type ModelPickerViewProps, type ModelPickerVariant } from './ModelPicker.view.js';
export {
  AVAILABILITY_HINT,
  AVAILABILITY_LABEL,
  contextSummary,
  filterModels,
  initialProvider,
  modelMeta,
} from './modelPickerModel.js';
