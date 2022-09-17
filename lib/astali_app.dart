// Copyright (C) 2022 Andrea Ballestrazzi
import 'package:flutter/material.dart';

import 'astali_injector.dart';
import 'astali_app_home.dart';

/// Represents the main widget app that is created at application initialization.
class AstaliApp extends StatelessWidget {
  /// Constructor: it expects an injector that will be used by the application
  /// to retrieve the main objects used by the application.
  const AstaliApp(AstaliInjector injector, {super.key})
      : mainInjector = injector;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(title: 'Astali', home: AstaliAppHome(mainInjector));
  }

  final AstaliInjector mainInjector;
}
