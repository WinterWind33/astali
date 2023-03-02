// Copyright (c) 2023 Andrea Ballestrazzi

import 'bulletin_board_card_id.dart';

// Core and engine
// Input managment
import 'package:flutter/gestures.dart';

typedef OnPointerUpOnBulletinBoardCard = void Function(
    BulletinBoardCardID, PointerUpEvent);

typedef OnPointerDownOnBulletinBoardCard = void Function(
    BulletinBoardCardID, PointerDownEvent);

typedef OnBulletinBoardCardFocusChanged = void Function(
    BulletinBoardCardID, bool);
