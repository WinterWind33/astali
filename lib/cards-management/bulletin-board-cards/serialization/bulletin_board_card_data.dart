// Copyright (c) 2023 Andrea Ballestrazzi
import 'package:astali/input-management/pointer_events.dart';

// Core and engine
import 'package:json_annotation/json_annotation.dart';

part 'bulletin_board_card_data.g.dart';

String mousePointToJson(final MousePoint point) {
  return "${point.x},${point.y}";
}

MousePoint mousePointFromJson(final String jsonStr) {
  final splitted = jsonStr.split(',');

  MousePoint result =
      MousePoint(double.parse(splitted[0]), double.parse(splitted[1]));

  return result;
}

@JsonSerializable()
class BulletinBoardCardData {
  BulletinBoardCardData({required this.cardPosition});

  factory BulletinBoardCardData.fromJson(Map<String, dynamic> json) =>
      _$BulletinBoardCardDataFromJson(json);

  Map<String, dynamic> toJson() => _$BulletinBoardCardDataToJson(this);

  @JsonKey(
      name: "card_position",
      toJson: mousePointToJson,
      fromJson: mousePointFromJson)
  final MousePoint cardPosition;
}
